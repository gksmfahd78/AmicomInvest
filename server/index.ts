import { etfInfo } from "./etf";
import { FinancialsService } from "./financials";
import { ResearchService } from "./research";
import { DartService } from "./dart";
import { commonFinancialDate } from "../src/researchTypes";
import { AccountValuator, PerformanceStore } from "./performance";
import { JournalStore, planSchema, reviewSchema } from "./journal";
import { StockNewsStore } from "./news";
import "dotenv/config";
import { MarketAnalysisStore } from "./market-analysis";
import { ThemeCatalogStore } from "./themes";
import { realtime, type Tick } from "./realtime";
import { TradingRules } from "./trading";
import { dayExpiry } from "../src/tradingRules";
import { DrawingsStore, drawingsSchema } from "./drawings";
import express from "express";
import { randomBytes, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { Store, competitionPerformance, verifyPassword } from "./db";
import {
  stocks,
  catalogUpdatedAt,
  catalogNeedsRefresh,
  refreshCatalog,
  quote,
  candles,
  candlePage,
  book,
  provider,
  known,
  regularHours,
  marketDiagnostics,
  kospiClose,
  kis,
} from "./market";
import type { User } from "../src/types";
const store = new Store(
  process.env.DATABASE_PATH || "./data/study.sqlite",
  undefined,
  (symbol) => known(symbol).instrument ?? "stock",
);
if (!store.db.prepare("SELECT id FROM users WHERE role='admin'").get())
  store.createUser(
    process.env.ADMIN_USERNAME || "admin",
    "스터디 관리자",
    process.env.ADMIN_PASSWORD || "Study!2026",
    "admin",
  );
const themeCatalog = new ThemeCatalogStore();
const financials = new FinancialsService(kis, provider);
const research = new ResearchService(kis, provider);
const dart = new DartService(
  process.env.DART_API_KEY || process.env.OPENDART_API_KEY,
);
const marketAnalysis = new MarketAnalysisStore();
const stockNews = new StockNewsStore();
const drawingsStore = new DrawingsStore(store);
const tradingRules = new TradingRules(store);
const performance = new PerformanceStore(store);
const journal = new JournalStore(store);
const valuator = new AccountValuator(store, performance, quote, async () => {
  // Demo indices are explicitly synthetic, matching the demo provider.
  if (provider === "demo") return { kospi: 2500, kosdaq: 800 };
  const values = await Promise.allSettled(
    ["0001", "1001"].map(async (code) => {
      const data = await kis("inquire-index-price", "FHPUP02100000", {
        FID_COND_MRKT_DIV_CODE: "U",
        FID_INPUT_ISCD: code,
      });
      const price = Number(data.output?.bstp_nmix_prpr);
      if (!Number.isFinite(price) || price <= 0) throw Error("지수 시세 누락");
      return price;
    }),
  );
  return {
    kospi: values[0].status === "fulfilled" ? values[0].value : null,
    kosdaq: values[1].status === "fulfilled" ? values[1].value : null,
  };
});
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

async function portfolioValue(userId: number, cash: number) {
  let assets = cash;
  for (const holding of store.db
    .prepare(
      "SELECT symbol,quantity FROM holdings WHERE user_id=? AND quantity>0",
    )
    .all(userId))
    assets +=
      Number(holding.quantity) * (await quote(String(holding.symbol))).price;
  if (!Number.isSafeInteger(assets) || assets < 0)
    throw Error("평가자산 한도를 초과했습니다.");
  return assets;
}

const koreaDate = (at = Date.now()) =>
  new Date(at + 9 * 3600000).toISOString().slice(0, 10);
let competitionSync: Promise<void> | null = null;
async function finishDueCompetitions() {
  if (competitionSync) return competitionSync;
  competitionSync = (async () => {
    const due = store.db
      .prepare(
        "SELECT * FROM competitions WHERE status='active' AND ends_at<=? ORDER BY ends_at",
      )
      .all(Date.now());
    for (const competition of due) {
      const entries = store.competitionEntries(Number(competition.id));
      const ending = await Promise.all(
        entries.map(async (entry) => ({
          userId: Number(entry.user_id),
          assets: await portfolioValue(
            Number(entry.user_id),
            Number(entry.cash),
          ),
          deposits: Number(entry.deposits),
        })),
      );
      const benchmark = await kospiClose(
        koreaDate(Number(competition.ends_at)),
      );
      store.finishCompetition(Number(competition.id), benchmark.value, ending);
    }
  })().finally(() => {
    competitionSync = null;
  });
  return competitionSync;
}
setInterval(() => void finishDueCompetitions().catch(() => {}), 5000).unref();
setTimeout(() => void finishDueCompetitions().catch(() => {}), 1000).unref();

function competitionList() {
  return store.competitions().map((row) => {
    const start = Number(row.benchmark_start);
    const end = row.benchmark_end === null ? null : Number(row.benchmark_end);
    return {
      ...row,
      id: Number(row.id),
      starts_at: Number(row.starts_at),
      ends_at: Number(row.ends_at),
      benchmark_start: start,
      benchmark_end: end,
      benchmark_rate: end === null ? null : ((end - start) / start) * 100,
      participant_count: Number(row.participant_count),
      status:
        row.status === "active" && Number(row.ends_at) <= Date.now()
          ? "finalizing"
          : row.status,
    };
  });
}

app.get("/api/meta", (_req, res) =>
  res.json({ provider, inviteRequired: true, tradingCosts: store.costs }),
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
app.get("/api/stock-news", auth, async (req, res) => {
  const symbol = z
    .string()
    .regex(/^[A-Z0-9]{6}$/)
    .parse(req.query.symbol);
  const stock = stocks.find((stock) => stock.symbol === symbol);
  if (!stock) {
    res.status(404).json({ error: "지원하지 않는 종목입니다." });
    return;
  }
  try {
    res.json(await stockNews.get(stock));
  } catch {
    res.status(503).json({
      error: "뉴스를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
  }
});
app.get("/api/stock-themes", auth, async (_req, res) => {
  try {
    res.json(await themeCatalog.get());
  } catch {
    res.status(503).json({
      error: "테마 분류를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
    });
  }
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
  const failedSymbols = data.flatMap((result, index) =>
    result.status === "rejected" ? [symbols[index]] : [],
  );
  res.json({
    quotes: data
      .filter(
        (x): x is PromiseFulfilledResult<Awaited<ReturnType<typeof quote>>> =>
          x.status === "fulfilled",
      )
      .map((x) => x.value),
    failedSymbols,
    error: failedSymbols.length
      ? failedSymbols.length +
        "개 종목의 시세를 불러오지 못했습니다. 잠시 후 다시 조회해주세요."
      : null,
  });
});
app.get("/api/etf/:symbol", auth, async (req, res) => {
  res.json(await etfInfo(String(req.params.symbol)));
});
app.get("/api/financials/:symbol", auth, async (req, res) => {
  const symbol = String(req.params.symbol);
  const stock = known(symbol);
  if (stock.instrument === "etf") {
    res
      .status(400)
      .json({ error: "ETF는 기업 재무제표 대신 상품 정보를 확인해주세요." });
    return;
  }
  const period = z
    .enum(["annual", "quarter"])
    .parse(req.query.period || "annual");
  res.json(await financials.get(symbol, period));
});

app.get("/api/research/:symbol/:section", auth, async (req, res) => {
  const symbol = String(req.params.symbol);
  const stock = known(symbol);
  if (stock.instrument === "etf") {
    res.status(400).json({ error: "ETF는 상품 정보에서 확인해주세요." });
    return;
  }
  const section = z
    .enum(["flows", "estimates", "dividends", "peers", "filings", "dart"])
    .parse(req.params.section);
  if (section === "peers") {
    const query = z
      .string()
      .max(30)
      .parse(req.query.symbols ?? "");
    const symbols = [...new Set([symbol, ...query.split(",").filter(Boolean)])];
    if (symbols.length > 3)
      throw Error("기업 비교는 기준 종목을 포함해 최대 3개입니다.");
    const selected = symbols.map((code) => {
      const item = known(code);
      if (item.instrument === "etf")
        throw Error("기업 비교에서는 주식만 선택할 수 있습니다.");
      return item;
    });
    const companies = await Promise.all(
      selected.map(async (item) => {
        const [profile, data] = await Promise.all([
          research.profile(item.symbol),
          financials.get(item.symbol, "annual"),
        ]);
        return {
          symbol: item.symbol,
          name: item.name,
          profile,
          financials: data,
        };
      }),
    );
    res.json({
      symbol,
      section,
      status: "ok",
      source: provider,
      receivedAt: Date.now(),
      data: { date: commonFinancialDate(companies), companies },
    });
    return;
  }
  const result =
    section === "dart"
      ? await dart.statement(
          symbol,
          z.coerce
            .number()
            .int()
            .min(2015)
            .max(new Date().getUTCFullYear())
            .parse(req.query.year ?? new Date().getUTCFullYear() - 1),
          z
            .enum(["11011", "11013", "11012", "11014"])
            .parse(req.query.report ?? "11011"),
          z.enum(["CFS", "OFS"]).parse(req.query.basis ?? "CFS"),
        )
      : section === "filings"
        ? await dart.filings(symbol)
        : await research[section](symbol);
  res.json({ symbol, section, ...result });
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
  res.json({
    quote: q,
    candles: c,
    book: b,
    execution: await tradingRules.inspect(symbol, b),
  });
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
        symbol: String(h.symbol),
        quantity: Number(h.quantity),
        cost: Number(h.cost),
        price,
        name: known(String(h.symbol)).name,
        instrument: store.instrument(String(h.symbol)),
        reserved: store.reservedShares(u.id, String(h.symbol)),
      };
    }),
  );
  res.json({
    cash: u.cash,
    available: u.cash - store.reservedCash(u.id),
    deposits: u.deposits,
    realized: u.realized,
    dividends: u.dividends,
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
            "SELECT id,quantity,price,fee,tax,realized_pnl,cost_basis,created_at,book_received_at,reference_price,available_quantity,execution_note FROM fills WHERE order_id=? ORDER BY id",
          )
          .all(o.id!),
      })),
  });
});
app.get("/api/analytics", auth, (_req, res) => {
  const report = performance.report(res.locals.user.id);
  res.json({
    ...store.analytics(res.locals.user.id),
    maxDrawdown: report.maxDrawdown,
    snapshotCount: report.count,
  });
});
app.get("/api/performance", auth, (req, res) => {
  const range = z
    .enum(["all", "day", "week", "month"])
    .parse(req.query.range || "all");
  const group = z
    .enum(["day", "week", "month"])
    .parse(req.query.group || "day");
  res.json({
    ...performance.report(res.locals.user.id, range, group),
    source: provider,
  });
});
app.get("/api/journal", auth, (req, res) => {
  const symbol = z
    .string()
    .regex(/^$|^[A-Z0-9]{6}$/)
    .parse(req.query.symbol || "");
  const page = z.coerce
    .number()
    .int()
    .min(0)
    .max(100000)
    .parse(req.query.page || 0);
  const filter = z
    .enum(["all", "unreviewed", "reviewed"])
    .parse(req.query.filter || "all");
  res.json(journal.list(res.locals.user.id, symbol, page, filter));
});
app.post("/api/journal/:id", auth, (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const input = z
    .object({ revision: z.number().int().nonnegative(), review: reviewSchema })
    .parse(req.body);
  res.json(journal.save(res.locals.user.id, id, input.revision, input.review));
});
const orderSchema = z
  .object({
    symbol: z.string(),
    side: z.enum(["buy", "sell"]),
    type: z.enum(["market", "limit"]),
    quantity: z.number().int().min(1).max(1000000),
    limitPrice: z.number().int().min(1).max(100000000).optional(),
    note: z.string().max(300).default(""),
    plan: planSchema.default({}),
    requestId: z.string().uuid(),
  })
  .refine((x) => x.type !== "limit" || x.limitPrice !== undefined, {
    message: "지정가를 입력해주세요.",
  });
app.post("/api/orders", auth, async (req, res) => {
  await finishDueCompetitions();
  const input = orderSchema.parse(req.body);
  known(input.symbol);
  const previous = store.db
    .prepare("SELECT * FROM orders WHERE user_id=? AND request_id=?")
    .get(res.locals.user.id, input.requestId);
  if (previous) {
    res.json({ order: previous });
    return;
  }
  const q = await book(input.symbol);
  await tradingRules.check(
    input.symbol,
    input.type === "limit" ? input.limitPrice : undefined,
    q,
  );
  if (Date.now() - q.receivedAt > 20000)
    throw Error("시세가 오래되어 주문을 처리할 수 없습니다.");
  const order = store.transaction(() => {
    const result = store.place(
      res.locals.user.id,
      {
        ...input,
        expiresAt: provider === "demo" ? Date.now() + 86400000 : dayExpiry(),
      },
      q,
    )!;
    journal.capture(res.locals.user.id, Number(result.id), input.plan, q);
    return result;
  });
  res.json({ order });
});

app.post("/api/orders/:id/amend", auth, async (req, res) => {
  await finishDueCompetitions();
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
  const q = await book(String(old.symbol));
  await tradingRules.check(String(old.symbol), input.limitPrice, q);
  const order = store.transaction(() => {
    const result = store.amend(res.locals.user.id, id, input, q)!;
    journal.capture(
      res.locals.user.id,
      Number(result.id),
      { horizon: "", invalidation: "", source: "" },
      q,
      id,
    );
    return result;
  });
  res.json({ order });
});
app.post("/api/orders/:id/cancel", auth, (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  store.cancel(res.locals.user.id, id);
  res.json({ ok: true });
});
app.get("/api/admin/members", admin, async (_req, res) => {
  await finishDueCompetitions().catch(() => {});
  const users = store.db
    .prepare(
      "SELECT id,username,name,role,cash,deposits FROM users ORDER BY id",
    )
    .all();
  const members = await Promise.all(
    users.map(async (member) => {
      const id = Number(member.id);
      const cash = Number(member.cash);
      const deposits = Number(member.deposits);
      const available = cash - store.reservedCash(id);
      let assets: number | null = null;
      try {
        assets = await portfolioValue(id, cash);
      } catch {}
      return {
        ...member,
        cash,
        deposits,
        available,
        assets,
        profit: assets === null ? null : assets - deposits,
      };
    }),
  );
  const complete = members.every((member) => member.assets !== null);
  const assets = complete
    ? members.reduce((sum, member) => sum + Number(member.assets), 0)
    : null;
  const deposits = members.reduce((sum, member) => sum + member.deposits, 0);
  const available = members.reduce((sum, member) => sum + member.available, 0);
  res.json({
    members,
    summary: {
      assets,
      profit: assets === null ? null : assets - deposits,
      available,
      deposits,
      reserved: members.reduce(
        (sum, member) => sum + member.cash - member.available,
        0,
      ),
    },
    grants: store.db
      .prepare(
        "SELECT g.id,u.name,g.amount,g.note,g.created_at FROM grants g JOIN users u ON u.id=g.user_id ORDER BY g.id DESC LIMIT 100",
      )
      .all(),
    corporateActions: store.db
      .prepare("SELECT * FROM corporate_actions ORDER BY id DESC LIMIT 100")
      .all(),
    marketStatus: {
      provider,
      rest: { ...marketDiagnostics },
      realtime: realtime.diagnostics(),
    },
    competitions: competitionList(),
  });
});
app.post("/api/admin/grants", admin, async (req, res) => {
  await finishDueCompetitions();
  const input = z
    .object({
      userId: z.number().int().positive(),
      amount: z.number().int().min(1).max(1000000000),
      note: z.string().trim().min(1).max(200),
      requestId: z.string().uuid(),
    })
    .parse(req.body);
  const [prices, marks] = await Promise.all([
    valuator.prices(input.userId),
    valuator.indices().catch(() => ({ kospi: null, kosdaq: null })),
  ]);
  store.transaction(() => {
    if (
      store.db
        .prepare("SELECT id FROM grants WHERE request_id=?")
        .get(input.requestId)
    )
      return;
    const now = Date.now();
    let equity: number | null = null;
    try {
      equity = performance.value(input.userId, prices, now);
    } catch {
      /* Grant can proceed; unavailable flow boundaries will be reported as a gap. */
    }
    if (equity !== null)
      performance.record(input.userId, equity, now, "flow_before", marks);
    store.grant(
      res.locals.user.id,
      input.userId,
      input.amount,
      input.note,
      input.requestId,
    );
    if (equity !== null)
      performance.record(
        input.userId,
        equity + input.amount,
        now,
        "flow_after",
        marks,
      );
  });
  res.json({ ok: true });
});
app.post("/api/admin/competitions", admin, async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(1).max(60),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      requestId: z.string().uuid(),
    })
    .parse(req.body);
  const previous = store.db
    .prepare("SELECT * FROM competitions WHERE request_id=?")
    .get(input.requestId);
  if (previous) {
    res.json({ competition: previous });
    return;
  }
  await finishDueCompetitions();
  const startsAt = Date.now();
  const endsAt = Date.parse(input.endDate + "T06:30:00.000Z");
  if (!Number.isFinite(endsAt) || endsAt <= startsAt)
    throw Error("종료일은 오늘 장 마감 이후 또는 미래 날짜여야 합니다.");
  const users = store.db
    .prepare("SELECT id,cash,deposits FROM users ORDER BY id")
    .all();
  const entries = await Promise.all(
    users.map(async (member) => ({
      userId: Number(member.id),
      assets: await portfolioValue(Number(member.id), Number(member.cash)),
      deposits: Number(member.deposits),
    })),
  );
  const benchmark = await kospiClose();
  const competition = store.createCompetition(res.locals.user.id, {
    name: input.name,
    startsAt,
    endsAt,
    benchmarkStart: benchmark.value,
    requestId: input.requestId,
    entries,
  });
  res.json({ competition });
});
app.post("/api/admin/competitions/:id/cancel", admin, async (req, res) => {
  await finishDueCompetitions();
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const input = z
    .object({ reason: z.string().trim().min(1).max(200) })
    .parse(req.body);
  const competition = store.cancelCompetition(
    res.locals.user.id,
    id,
    input.reason,
  );
  res.json({ competition });
});

app.post("/api/admin/corporate-actions", admin, async (req, res) => {
  await finishDueCompetitions();
  const input = z
    .object({
      symbol: z.string().regex(/^[A-Z0-9]{6}$/),
      type: z.enum(["dividend", "split"]),
      numerator: z.number().int().min(1).max(1000).optional(),
      denominator: z.number().int().min(1).max(1000).optional(),
      cashPerShare: z.number().int().min(0).max(10000000).optional(),
      effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      note: z.string().trim().min(1).max(200),
      requestId: z.string().uuid(),
    })
    .refine(
      (value) =>
        value.type === "dividend"
          ? value.cashPerShare !== undefined
          : value.numerator !== undefined && value.denominator !== undefined,
      { message: "기업행사 값을 확인해주세요." },
    )
    .parse(req.body);
  known(input.symbol);
  const action = store.applyCorporateAction(res.locals.user.id, input);
  res.json({ action });
});
app.get("/api/ranking", auth, async (req, res) => {
  await finishDueCompetitions().catch(() => {});
  const competitions = competitionList();
  const requested = req.query.competitionId
    ? z.coerce.number().int().positive().parse(req.query.competitionId)
    : null;
  const competition = requested
    ? competitions.find((item) => item.id === requested)
    : (competitions.find((item) => item.status !== "cancelled") ??
      competitions[0]);
  if (!competition) {
    res.json({ competition: null, competitions, members: [] });
    return;
  }
  const benchmarkNow =
    competition.status === "cancelled"
      ? null
      : competition.status === "ended"
        ? competition.benchmark_end
        : (await kospiClose()).value;
  const benchmarkRate =
    benchmarkNow === null
      ? null
      : ((benchmarkNow - competition.benchmark_start) /
          competition.benchmark_start) *
        100;
  const rows = await Promise.all(
    store.competitionEntries(competition.id).map(async (entry) => {
      let assets: number | null =
        competition.status === "ended" && entry.ending_assets !== null
          ? Number(entry.ending_assets)
          : null;
      const deposits =
        competition.status === "ended" && entry.ending_deposits !== null
          ? Number(entry.ending_deposits)
          : Number(entry.deposits);
      if (
        competition.status === "active" ||
        competition.status === "finalizing"
      )
        try {
          assets = await portfolioValue(
            Number(entry.user_id),
            Number(entry.cash),
          );
        } catch {
          assets = null;
        }
      const startingAssets = Number(entry.starting_assets);
      const netGrants = Math.max(0, deposits - Number(entry.starting_deposits));
      const performance =
        assets === null || benchmarkRate === null
          ? { netGrants, rate: null, excessRate: null }
          : competitionPerformance(
              startingAssets,
              Number(entry.starting_deposits),
              assets,
              deposits,
              benchmarkRate,
            );
      return {
        id: Number(entry.user_id),
        name: String(entry.name),
        startingAssets,
        assets,
        ...performance,
      };
    }),
  );
  res.json({
    competition: { ...competition, benchmark_rate: benchmarkRate },
    competitions,
    members: rows.sort((a, b) => (b.rate ?? -Infinity) - (a.rate ?? -Infinity)),
  });
});
app.get("/api/market-analysis", auth, async (req, res) => {
  const query = z
    .object({
      market: z.enum(["ALL", "KOSPI", "KOSDAQ"]).default("ALL"),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    })
    .parse(req.query);
  try {
    res.json(await marketAnalysis.get(query.market, query.date));
  } catch (error) {
    res.status(503).json({
      error: error instanceof Error ? error.message : "시장 분석 조회 실패",
    });
  }
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
    await finishDueCompetitions();
    const b = await book(symbol);
    await tradingRules.check(symbol, undefined, b);
    store.match(symbol, b);
  } catch (error) {
    store.defer(
      symbol,
      error instanceof Error
        ? error.message
        : "거래 상태 확인을 기다리고 있습니다.",
    );
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

if (
  catalogNeedsRefresh ||
  !catalogUpdatedAt ||
  Date.now() - Date.parse(catalogUpdatedAt) > 86400000
)
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

void themeCatalog
  .get()
  .catch(() =>
    console.warn(
      "테마 분류 초기 조회 실패: 종목 검색은 계속 사용할 수 있습니다.",
    ),
  );
setInterval(() => {
  void themeCatalog.refresh().catch(() => {});
}, 86400000).unref();

let collectingAnalysis = false;
async function collectAnalysisSnapshots() {
  if (collectingAnalysis) return;
  collectingAnalysis = true;
  try {
    for (const market of ["ALL", "KOSPI", "KOSDAQ"] as const)
      await marketAnalysis.get(market).catch(() => {});
  } finally {
    collectingAnalysis = false;
  }
}
void collectAnalysisSnapshots();
setInterval(() => {
  const now = new Date(Date.now() + 9 * 3600000);
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (
    now.getUTCDay() > 0 &&
    now.getUTCDay() < 6 &&
    minutes >= 540 &&
    minutes <= 950
  )
    void collectAnalysisSnapshots();
}, 300000).unref();

// Capture independently of account views, including a startup baseline and closing observation.
void valuator
  .collect()
  .catch(() => console.warn("계좌 평가 수집에 실패했습니다."));
setInterval(() => {
  const kst = new Date(Date.now() + 9 * 3600000);
  const minute = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  if (
    provider === "demo" ||
    (kst.getUTCDay() > 0 &&
      kst.getUTCDay() < 6 &&
      minute >= 540 &&
      minute <= 935)
  )
    void valuator
      .collect()
      .catch(() => console.warn("계좌 평가 수집에 실패했습니다."));
}, 300000).unref();
