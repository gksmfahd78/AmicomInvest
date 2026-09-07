import "dotenv/config";
import { realtime, type Tick } from "./realtime";
import { TradingRules } from "./trading";
import { dayExpiry } from "../src/tradingRules";
import { DrawingsStore, drawingsSchema } from "./drawings";
import express from "express";
import { randomBytes, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { Store, verifyPassword } from "./db";
import {
  stocks,
  catalogUpdatedAt,
  refreshCatalog,
  quote,
  candles,
  candlePage,
  book,
  provider,
  known,
  regularHours,
} from "./market";
import type { User } from "../src/types";
const store = new Store(process.env.DATABASE_PATH || "./data/study.sqlite");
if (!store.db.prepare("SELECT id FROM users WHERE role='admin'").get())
  store.createUser(
    process.env.ADMIN_USERNAME || "admin",
    "스터디 관리자",
    process.env.ADMIN_PASSWORD || "Study!2026",
    "admin",
  );
const drawingsStore = new DrawingsStore(store);
const tradingRules = new TradingRules(store);
const app = express();
app.disable("x-powered-by");
app.use("/api/drawings", express.json({ limit: "12mb" }));
app.use(express.json({ limit: "16kb" }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use("/api", (req, res, next) => {
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.get("X-Study-Client") !== "web"
  ) {
    res.status(403).json({ error: "허용되지 않은 요청입니다." });
    return;
  }
  next();
});
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const getSession = (req: express.Request) =>
  req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("study_session="))
    ?.slice(14) || "";
app.use("/api", (req, res, next) => {
  const token = getSession(req);
  if (token) {
    const s = store.db
      .prepare("SELECT user_id FROM sessions WHERE token=? AND expires>?")
      .get(digest(token), Date.now());
    if (s) res.locals.user = store.user(Number(s.user_id));
  }
  next();
});
const auth: express.RequestHandler = (_req, res, next) => {
  if (!res.locals.user) {
    res.status(401).json({ error: "로그인이 필요합니다." });
    return;
  }
  next();
};
const admin: express.RequestHandler = (req, res, next) =>
  auth(req, res, () => {
    if (res.locals.user.role !== "admin") {
      res.status(403).json({ error: "관리자만 사용할 수 있습니다." });
      return;
    }
    next();
  });
function login(res: express.Response, user: User) {
  const token = randomBytes(32).toString("hex");
  store.db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  store.db
    .prepare("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)")
    .run(digest(token), user.id, Date.now() + 7 * 86400000);
  res.cookie("study_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 7 * 86400000,
    path: "/",
  });
  res.json({ user });
}
const attempts = new Map<string, { count: number; until: number }>();
const rateLimit: express.RequestHandler = (req, res, next) => {
  const key = req.ip || "local";
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  const entry = attempts.get(key) || { count: 0, until: now + 60000 };
  entry.count++;
  attempts.set(key, entry);
  if (entry.count > 20) {
    res.status(429).json({ error: "잠시 후 다시 시도해주세요." });
    return;
  }
  next();
};

const streams = new Set<{
  user: number;
  symbol: string;
  res: express.Response;
  token: string;
}>();
function subscriptions() {
  const pending = store.db
    .prepare(
      "SELECT DISTINCT symbol FROM orders WHERE status='pending' ORDER BY id",
    )
    .all()
    .map((r) => String(r.symbol));
  realtime.setSymbols([...pending, ...[...streams].map((s) => s.symbol)]);
}
function sendStream(res: express.Response, data: unknown) {
  if (!res.writableEnded && !res.destroyed) {
    if (res.writableLength > 262144) {
      res.end();
      return;
    }
    res.write("data: " + JSON.stringify(data) + "\n\n");
  }
}
app.get("/api/stream", auth, (req, res) => {
  const symbol = z.string().parse(req.query.symbol);
  known(symbol);
  if ([...streams].filter((s) => s.user === res.locals.user.id).length >= 5) {
    res.status(429).json({ error: "열린 실시간 화면이 너무 많습니다." });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const stream = {
    user: res.locals.user.id,
    symbol,
    res,
    token: digest(getSession(req)),
  };
  streams.add(stream);
  subscriptions();
  sendStream(res, { kind: "status", status: realtime.mode(symbol) });
  req.on("close", () => {
    streams.delete(stream);
    subscriptions();
  });
});
const pendingTicks = new Map<string, Tick>();
realtime.on("tick", (tick: Tick) => {
  pendingTicks.set(tick.symbol, { ...pendingTicks.get(tick.symbol), ...tick });
});
setInterval(() => {
  for (const s of streams) {
    const t = pendingTicks.get(s.symbol);
    if (t)
      sendStream(s.res, {
        kind: "market",
        ...t,
        status: realtime.mode(s.symbol),
      });
  }
  pendingTicks.clear();
}, 250).unref();
setInterval(() => {
  for (const s of streams) {
    if (
      !store.db
        .prepare("SELECT 1 FROM sessions WHERE token=? AND expires>?")
        .get(s.token, Date.now())
    ) {
      s.res.end();
      streams.delete(s);
      continue;
    }
    sendStream(s.res, { kind: "status", status: realtime.mode(s.symbol) });
  }
  subscriptions();
}, 5000).unref();

app.get("/api/meta", (_req, res) =>
  res.json({ provider, inviteRequired: true }),
);
app.get("/api/me", auth, (_req, res) => res.json({ user: res.locals.user }));
const credentials = z.object({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128),
});
app.post("/api/login", rateLimit, (req, res) => {
  const input = credentials.parse(req.body);
  const u = store.db
    .prepare("SELECT * FROM users WHERE username=?")
    .get(input.username);
  if (!u || !verifyPassword(input.password, String(u.password))) {
    res
      .status(401)
      .json({ error: "아이디 또는 비밀번호가 일치하지 않습니다." });
    return;
  }
  login(res, store.user(Number(u.id)));
});
app.post("/api/register", rateLimit, (req, res) => {
  const input = credentials
    .extend({ name: z.string().trim().min(1).max(30), invite: z.string() })
    .parse(req.body);
  if (input.invite !== (process.env.STUDY_INVITE_CODE || "STUDY2026")) {
    res.status(403).json({ error: "초대 코드가 일치하지 않습니다." });
    return;
  }
  if (
    store.db
      .prepare("SELECT id FROM users WHERE username=?")
      .get(input.username)
  )
    throw Error("이미 사용 중인 아이디입니다.");
  login(res, store.createUser(input.username, input.name, input.password));
});
app.post("/api/logout", (_req, res) => {
  store.db
    .prepare("DELETE FROM sessions WHERE token=?")
    .run(digest(getSession(_req)));
  res.clearCookie("study_session", { path: "/" });
  res.json({ ok: true });
});
app.get("/api/stocks", auth, (_req, res) =>
  res.json({ stocks, updatedAt: catalogUpdatedAt }),
);
app.get("/api/quotes", auth, async (req, res) => {
  const raw = z
    .string()
    .max(200)
    .parse(
      req.query.symbols ??
        stocks
          .slice(0, 10)
          .map((s) => s.symbol)
          .join(","),
    );
  const symbols = [...new Set(raw.split(",").filter(Boolean))];
  if (symbols.length > 10)
    throw Error("시세는 한 번에 최대 10종목까지 조회할 수 있습니다.");
  symbols.forEach(known);
  const data = await Promise.allSettled(symbols.map(quote));
  res.json({
    quotes: data
      .filter(
        (x): x is PromiseFulfilledResult<Awaited<ReturnType<typeof quote>>> =>
          x.status === "fulfilled",
      )
      .map((x) => x.value),
    error: data.some((x) => x.status === "rejected")
      ? "일부 시세를 불러오지 못했습니다. API 설정과 연결을 확인해주세요."
      : null,
  });
});
app.get("/api/stock/:symbol", auth, async (req, res) => {
  const symbol = String(req.params.symbol);
  known(symbol);
  const period = z.enum(["D", "W", "M"]).parse(req.query.period || "D");
  const [q, c, b] = await Promise.all([
    quote(symbol),
    candles(symbol, period),
    book(symbol),
  ]);
  res.json({ quote: q, candles: c, book: b });
});

app.get("/api/drawings/:symbol", auth, (req, res) => {
  const symbol = String(req.params.symbol);
  known(symbol);
  const period = z.enum(["D", "W", "M"]).parse(req.query.period);
  res.json(drawingsStore.get(res.locals.user.id, symbol, period));
});
app.post("/api/drawings/:symbol", auth, (req, res) => {
  const symbol = String(req.params.symbol);
  known(symbol);
  const period = z.enum(["D", "W", "M"]).parse(req.query.period);
  const input = z
    .object({
      revision: z.number().int().nonnegative(),
      drawings: drawingsSchema,
    })
    .parse(req.body);
  res.json(
    drawingsStore.save(
      res.locals.user.id,
      symbol,
      period,
      input.revision,
      input.drawings,
    ),
  );
});
app.get("/api/history/:symbol", auth, async (req, res) => {
  const symbol = String(req.params.symbol);
  known(symbol);
  const period = z.enum(["D", "W", "M"]).parse(req.query.period || "D");
  const before = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => Number.isFinite(Date.parse(v)))
    .parse(req.query.before);
  const bars = await candlePage(symbol, period, before);
  res.json({ candles: bars, hasMore: bars.length > 0 });
});
async function tradable(symbol: string) {
  try {
    await tradingRules.check(symbol);
    return true;
  } catch {
    return false;
  }
}
app.get("/api/account", auth, async (_req, res) => {
  store.expire();
  const u = store.user(res.locals.user.id);
  const held = store.db
    .prepare(
      "SELECT symbol,quantity,cost FROM holdings WHERE user_id=? AND quantity>0",
    )
    .all(u.id);
  const holdings = await Promise.all(
    held.map(async (h) => {
      let price: number | null = null;
      try {
        price = (await quote(String(h.symbol))).price;
      } catch {}
      return {
        ...h,
        price,
        name: known(String(h.symbol)).name,
        reserved: store.reservedShares(u.id, String(h.symbol)),
      };
    }),
  );
  res.json({
    cash: u.cash,
    available: u.cash - store.reservedCash(u.id),
    deposits: u.deposits,
    realized: u.realized,
    holdings,
    orders: store.db
      .prepare(
        "SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 200",
      )
      .all(u.id)
      .map((o) => ({
        ...o,
        fills: store.db
          .prepare(
            "SELECT id,quantity,price,created_at FROM fills WHERE order_id=? ORDER BY id",
          )
          .all(o.id!),
      })),
  });
});
const orderSchema = z
  .object({
    symbol: z.string(),
    side: z.enum(["buy", "sell"]),
    type: z.enum(["market", "limit"]),
    quantity: z.number().int().min(1).max(1000000),
    limitPrice: z.number().int().min(1).max(100000000).optional(),
    note: z.string().max(300).default(""),
    requestId: z.string().uuid(),
  })
  .refine((x) => x.type !== "limit" || x.limitPrice !== undefined, {
    message: "지정가를 입력해주세요.",
  });
app.post("/api/orders", auth, async (req, res) => {
  const input = orderSchema.parse(req.body);
  known(input.symbol);
  const previous = store.db
    .prepare("SELECT * FROM orders WHERE user_id=? AND request_id=?")
    .get(res.locals.user.id, input.requestId);
  if (previous) {
    res.json({ order: previous });
    return;
  }
  await tradingRules.check(
    input.symbol,
    input.type === "limit" ? input.limitPrice : undefined,
  );
  const q = await book(input.symbol);
  if (Date.now() - q.receivedAt > 20000)
    throw Error("시세가 오래되어 주문을 처리할 수 없습니다.");
  res.json({
    order: store.place(
      res.locals.user.id,
      {
        ...input,
        expiresAt: provider === "demo" ? Date.now() + 86400000 : dayExpiry(),
      },
      q,
    ),
  });
});

app.post("/api/orders/:id/amend", auth, async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const input = z
    .object({
      quantity: z.number().int().positive().max(1000000),
      limitPrice: z.number().int().positive().max(100000000),
      expectedFilled: z.number().int().nonnegative(),
      requestId: z.string().uuid(),
    })
    .parse(req.body);
  const old = store.db
    .prepare("SELECT * FROM orders WHERE id=? AND user_id=?")
    .get(id, res.locals.user.id);
  if (!old) throw Error("주문을 찾을 수 없습니다.");
  const existing = store.db
    .prepare(
      "SELECT * FROM orders WHERE user_id=? AND request_id=? AND replaces_id=?",
    )
    .get(res.locals.user.id, input.requestId, id);
  if (existing) {
    res.json({ order: existing });
    return;
  }
  await tradingRules.check(String(old.symbol), input.limitPrice);
  res.json({
    order: store.amend(
      res.locals.user.id,
      id,
      input,
      await book(String(old.symbol)),
    ),
  });
});
app.post("/api/orders/:id/cancel", auth, (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  store.cancel(res.locals.user.id, id);
  res.json({ ok: true });
});
app.get("/api/admin/members", admin, (_req, res) =>
  res.json({
    members: store.db
      .prepare(
        "SELECT id,username,name,role,cash,deposits FROM users ORDER BY id",
      )
      .all(),
    grants: store.db
      .prepare(
        "SELECT g.id,u.name,g.amount,g.note,g.created_at FROM grants g JOIN users u ON u.id=g.user_id ORDER BY g.id DESC LIMIT 100",
      )
      .all(),
  }),
);
app.post("/api/admin/grants", admin, (req, res) => {
  const input = z
    .object({
      userId: z.number().int().positive(),
      amount: z.number().int().min(1).max(1000000000),
      note: z.string().trim().min(1).max(200),
      requestId: z.string().uuid(),
    })
    .parse(req.body);
  store.grant(
    res.locals.user.id,
    input.userId,
    input.amount,
    input.note,
    input.requestId,
  );
  res.json({ ok: true });
});
app.get("/api/ranking", auth, async (_req, res) => {
  const members = store.db
    .prepare("SELECT id,name,cash,deposits FROM users")
    .all();
  const rows = await Promise.all(
    members.map(async (m) => {
      let assets = Number(m.cash);
      let complete = true;
      for (const h of store.db
        .prepare(
          "SELECT symbol,quantity FROM holdings WHERE user_id=? AND quantity>0",
        )
        .all(m.id as number)) {
        try {
          assets += Number(h.quantity) * (await quote(String(h.symbol))).price;
        } catch {
          complete = false;
        }
      }
      return {
        id: m.id,
        name: m.name,
        deposits: m.deposits,
        assets: complete ? assets : null,
        rate:
          complete && Number(m.deposits) > 0
            ? ((assets - Number(m.deposits)) / Number(m.deposits)) * 100
            : null,
      };
    }),
  );
  res.json({
    members: rows.sort((a, b) => (b.rate ?? -Infinity) - (a.rate ?? -Infinity)),
  });
});
app.get("/api/health", (_req, res) => res.json({ ok: true, provider }));
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "존재하지 않는 API입니다." }),
);
if (existsSync(resolve("dist/index.html"))) {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
}
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: "입력값을 확인해주세요. " + error.issues[0].message });
      return;
    }
    const message =
      error instanceof Error
        ? error.message
        : "요청 처리 중 오류가 발생했습니다.";
    res.status(400).json({
      error: message.includes("SQLITE")
        ? "저장 중 오류가 발생했습니다."
        : message,
    });
  },
);

const matchingSymbols = new Set<string>();
async function matchSymbol(symbol: string) {
  if (matchingSymbols.has(symbol)) return;
  matchingSymbols.add(symbol);
  try {
    if (await tradable(symbol)) {
      const b = await book(symbol);
      if (Date.now() - b.receivedAt < 20000) store.match(symbol, b);
    }
  } catch {
  } finally {
    matchingSymbols.delete(symbol);
  }
}
realtime.on("tick", (t: Tick) => {
  if (
    t.book &&
    store.db
      .prepare(
        "SELECT 1 FROM orders WHERE symbol=? AND status='pending' LIMIT 1",
      )
      .get(t.symbol)
  )
    void matchSymbol(t.symbol);
});
setInterval(async () => {
  store.expire();
  subscriptions();
  for (const row of store.db
    .prepare("SELECT DISTINCT symbol FROM orders WHERE status='pending'")
    .all())
    await matchSymbol(String(row.symbol));
}, 15000).unref();
let lastFill = Number(
  store.db.prepare("SELECT COALESCE(MAX(id),0) n FROM fills").get()!.n,
);
setInterval(() => {
  store.expire();
  const fills = store.db
    .prepare(
      "SELECT f.*,o.user_id,o.symbol,o.side FROM fills f JOIN orders o ON o.id=f.order_id WHERE f.id>? ORDER BY f.id LIMIT 1000",
    )
    .all(lastFill);
  for (const f of fills) {
    lastFill = Number(f.id);
    for (const s of streams)
      if (s.user === f.user_id)
        sendStream(s.res, {
          kind: "fill",
          id: f.id,
          message:
            (stocks.find((x) => x.symbol === f.symbol)?.name || f.symbol) +
            " " +
            (f.side === "buy" ? "매수" : "매도") +
            " " +
            f.quantity +
            "주 · " +
            Number(f.price).toLocaleString() +
            "원 체결",
        });
  }
}, 1000).unref();
app.listen(
  Number(process.env.PORT) || 3001,
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      "Study Stock: http://" +
        (process.env.HOST || "127.0.0.1") +
        ":" +
        (process.env.PORT || 3001) +
        " (" +
        provider +
        ")",
    ),
);

if (!catalogUpdatedAt || Date.now() - Date.parse(catalogUpdatedAt) > 86400000)
  refreshCatalog().catch(() =>
    console.warn("전체 종목 갱신 실패: 저장된 목록을 유지합니다."),
  );
setInterval(
  () =>
    refreshCatalog().catch(() =>
      console.warn("전체 종목 갱신 실패: 저장된 목록을 유지합니다."),
    ),
  86400000,
).unref();
