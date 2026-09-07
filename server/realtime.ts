import WebSocket from "ws";
import { EventEmitter } from "node:events";
import type { Book, Quote } from "../src/types";
export type Tick = { symbol: string; book?: Book; quote?: Quote };
export function parseTick(raw: string, now = Date.now()): Tick[] {
  const [encrypted, tr, count, payload] = raw.split("|");
  if (encrypted !== "0" || !payload) return [];
  const size = tr === "H0STASP0" ? 59 : tr === "H0STCNT0" ? 46 : 0;
  if (!size || Number(count) < 1 || Number(count) > 100) return [];
  const fields = payload.split("^"),
    result: Tick[] = [];
  if (fields.length < size * Number(count)) return [];
  for (let i = 0; i < Number(count); i++) {
    const d = fields.slice(i * size, (i + 1) * size),
      symbol = d[0];
    if (!/^[A-Z0-9]{6}$/.test(symbol)) continue;
    const n = (j: number) => Number(d[j]);
    if (tr === "H0STASP0") {
      const levels = (p: number, q: number) =>
        Array.from({ length: 10 }, (_, j) => ({
          price: n(p + j),
          quantity: n(q + j),
        }));
      const b: Book = {
        receivedAt: now,
        exchangeTime: d[1],
        session: d[2],
        asks: levels(3, 23),
        bids: levels(13, 33),
      };
      if (
        [...b.asks, ...b.bids].every(
          (l) =>
            Number.isSafeInteger(l.price) &&
            l.price >= 0 &&
            Number.isSafeInteger(l.quantity) &&
            l.quantity >= 0,
        )
      )
        result.push({ symbol, book: b });
    } else if (
      Number.isSafeInteger(n(2)) &&
      n(2) > 0 &&
      [4, 5, 7, 8, 9, 13].every((j) => Number.isFinite(n(j)))
    ) {
      result.push({
        symbol,
        quote: {
          symbol,
          price: n(2),
          change: n(4),
          changeRate: n(5),
          open: n(7),
          high: n(8),
          low: n(9),
          volume: n(13),
          source: "kis",
          receivedAt: now,
          halted: d[35] === "Y",
          exchangeTime: d[1],
          tradingDate: d[33],
        },
      });
    }
  }
  return result;
}
export class Realtime extends EventEmitter {
  quotes = new Map<string, Quote>();
  books = new Map<string, Book>();
  private ws?: WebSocket;
  private wanted: string[] = [];
  private sent = new Set<string>();
  private key = "";
  private connecting = false;
  private retryAt = 0;
  private backoff = 1000;
  private lastMessage = 0;
  status = "연결 대기";
  constructor(private enabled: boolean) {
    super();
    if (!enabled) this.status = "샘플 시세";
  }
  setSymbols(symbols: string[]) {
    this.wanted = [...new Set(symbols)].slice(0, 20); // two feeds per symbol, 40 subscriptions
    if (!this.enabled) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (Date.now() - this.lastMessage > 90000) {
        this.ws.terminate();
        return;
      }
      this.sync();
    } else if (
      this.wanted.length &&
      !this.connecting &&
      Date.now() >= this.retryAt
    )
      void this.connect();
  }
  private async connect() {
    this.connecting = true;
    this.status = "실시간 연결 중";
    try {
      const res = await fetch(
        "https://openapi.koreainvestment.com:9443/oauth2/Approval",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "client_credentials",
            appkey: process.env.KIS_APP_KEY,
            secretkey: process.env.KIS_APP_SECRET,
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      const d = await res.json();
      if (!res.ok || !d.approval_key) throw Error("approval");
      this.key = d.approval_key;
      const ws = (this.ws = new WebSocket(
        "ws://ops.koreainvestment.com:21000",
        { handshakeTimeout: 10000 },
      ));
      ws.on("open", () => {
        this.connecting = false;
        this.sent.clear();
        this.lastMessage = Date.now();
        this.status = "실시간 수신 대기";
        this.sync();
      });
      ws.on("message", (raw) => {
        const text = raw.toString();
        this.lastMessage = Date.now();
        if (text.startsWith("{")) {
          try {
            const d = JSON.parse(text);
            if (d.header?.tr_id === "PINGPONG") ws.pong(text);
            else if (d.body?.rt_cd && d.body.rt_cd !== "0") {
              this.status = "조회 모드 · 실시간 재연결 중";
              ws.close();
            }
          } catch {}
          return;
        }
        for (const tick of parseTick(text)) {
          this.backoff = 1000;
          this.status = "실시간 연결";
          if (tick.quote) this.quotes.set(tick.symbol, tick.quote);
          if (tick.book) this.books.set(tick.symbol, tick.book);
          this.emit("tick", tick);
        }
      });
      ws.on("error", () => ws.terminate());
      ws.on("close", () => {
        this.connecting = false;
        this.sent.clear();
        this.status = "조회 모드 · 재연결 중";
        this.retryAt = Date.now() + this.backoff;
        this.backoff = Math.min(60000, this.backoff * 2);
      });
    } catch {
      this.connecting = false;
      this.status = "조회 모드 · 연결 실패";
      this.retryAt = Date.now() + 60000;
    }
  }
  private sync() {
    const send = (s: string, type: string) => {
      for (const tr of ["H0STASP0", "H0STCNT0"])
        this.ws!.send(
          JSON.stringify({
            header: {
              approval_key: this.key,
              custtype: "P",
              tr_type: type,
              "content-type": "utf-8",
            },
            body: { input: { tr_id: tr, tr_key: s } },
          }),
        );
    };
    for (const s of this.sent)
      if (!this.wanted.includes(s)) {
        send(s, "2");
        this.sent.delete(s);
        this.quotes.delete(s);
        this.books.delete(s);
      }
    for (const s of this.wanted)
      if (!this.sent.has(s)) {
        send(s, "1");
        this.sent.add(s);
      }
  }
  mode(symbol: string) {
    const at = Math.max(
      this.books.get(symbol)?.receivedAt || 0,
      this.quotes.get(symbol)?.receivedAt || 0,
    );
    return this.enabled
      ? Date.now() - at < 20000
        ? "실시간 수신"
        : "조회 모드 · " + this.status
      : "샘플 시세";
  }
}
export const realtime = new Realtime(process.env.MARKET_PROVIDER === "kis");
