import { realtime } from "./realtime";
import { readCatalog, downloadCatalog } from "./catalog";
import type { Stock, Quote, Candle, Book } from "../src/types";
const sampleStocks: Stock[] = [
  {
    symbol: "005930",
    name: "삼성전자",
    market: "KOSPI",
    sector: "반도체",
    base: 72800,
  },
  {
    symbol: "000660",
    name: "SK하이닉스",
    market: "KOSPI",
    sector: "반도체",
    base: 186500,
  },
  {
    symbol: "035420",
    name: "NAVER",
    market: "KOSPI",
    sector: "인터넷",
    base: 214000,
  },
  {
    symbol: "035720",
    name: "카카오",
    market: "KOSPI",
    sector: "인터넷",
    base: 42600,
  },
  {
    symbol: "005380",
    name: "현대차",
    market: "KOSPI",
    sector: "자동차",
    base: 238000,
  },
  {
    symbol: "051910",
    name: "LG화학",
    market: "KOSPI",
    sector: "화학",
    base: 312000,
  },
  {
    symbol: "068270",
    name: "셀트리온",
    market: "KOSPI",
    sector: "바이오",
    base: 178500,
  },
  {
    symbol: "105560",
    name: "KB금융",
    market: "KOSPI",
    sector: "금융",
    base: 86500,
  },
];
const savedCatalog = readCatalog();
export const stocks: Stock[] = savedCatalog?.stocks ?? sampleStocks;
export let catalogUpdatedAt = savedCatalog?.updatedAt ?? null;
function prioritize() {
  const priority = new Map(sampleStocks.map((s, i) => [s.symbol, i]));
  stocks.sort(
    (a, b) =>
      (priority.get(a.symbol) ?? 99) - (priority.get(b.symbol) ?? 99) ||
      a.name.localeCompare(b.name, "ko"),
  );
}
prioritize();
let syncing: Promise<void> | undefined;
export function refreshCatalog() {
  if (syncing) return syncing;
  syncing = downloadCatalog()
    .then((c) => {
      stocks.splice(0, stocks.length, ...c.stocks);
      catalogUpdatedAt = c.updatedAt;
      prioritize();
    })
    .finally(() => {
      syncing = undefined;
    });
  return syncing;
}
export const provider = process.env.MARKET_PROVIDER === "kis" ? "kis" : "demo";
const base = "https://openapi.koreainvestment.com:9443";
let token = "";
let tokenUntil = 0;
let authenticating: Promise<string> | undefined;
async function getToken(): Promise<string> {
  if (token && Date.now() < tokenUntil) return token;
  if (authenticating) return authenticating;
  authenticating = (async () => {
    if (!process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET)
      throw Error("서버에 한국투자증권 API 키를 설정해주세요.");
    const res = await fetch(base + "/oauth2/tokenP", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!res.ok || !data.access_token)
      throw Error("시세 API 인증에 실패했습니다. 서버 키 설정을 확인해주세요.");
    token = data.access_token;
    tokenUntil = Date.now() + Math.max(0, Number(data.expires_in) - 120) * 1000;
    return token;
  })();
  try {
    return await authenticating;
  } finally {
    authenticating = undefined;
  }
}
let queue: Promise<unknown> = Promise.resolve();
export async function kis(
  path: string,
  tr: string,
  params: Record<string, string>,
) {
  const operation = queue.then(async () => {
    const access = await getToken();
    await new Promise((r) => setTimeout(r, 150));
    const res = await fetch(
      base +
        "/uapi/domestic-stock/v1/quotations/" +
        path +
        "?" +
        new URLSearchParams(params),
      {
        headers: {
          authorization: "Bearer " + access,
          appkey: process.env.KIS_APP_KEY!,
          appsecret: process.env.KIS_APP_SECRET!,
          tr_id: tr,
          custtype: "P",
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    const data = await res.json();
    if (!res.ok || data.rt_cd !== "0")
      throw Error(
        "실제 시세를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
      );
    return data;
  });
  queue = operation.catch(() => {});
  return operation;
}
const cache = new Map<string, { at: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
async function cached<T>(
  key: string,
  ttl: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const ongoing = pending.get(key);
  if (ongoing) return ongoing as Promise<T>;
  const task = fn()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
function params(symbol: string) {
  return { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: symbol };
}
export function known(symbol: string) {
  const s = stocks.find((s) => s.symbol === symbol);
  if (!s) throw Error("지원하지 않는 종목입니다.");
  return s;
}
export function regularHours() {
  const d = new Date(Date.now() + 9 * 3600000);
  const min = d.getUTCHours() * 60 + d.getUTCMinutes();
  return d.getUTCDay() > 0 && d.getUTCDay() < 6 && min >= 540 && min < 930;
}
export async function quote(symbol: string): Promise<Quote> {
  const stock = known(symbol);
  const live = realtime.quotes.get(symbol);
  if (live && Date.now() - live.receivedAt < 10000) return live;
  return cached("q" + symbol, provider === "demo" ? 3000 : 10000, async () => {
    if (provider === "demo") {
      const change =
        Math.round(
          ((Math.sin(Math.floor(Date.now() / 15000) / 19 + Number(symbol)) *
            0.012 +
            0.018) *
            stock.base) /
            100,
        ) * 100;
      return {
        symbol,
        price: stock.base + change,
        change,
        changeRate: (change / stock.base) * 100,
        high: stock.base + Math.round((stock.base * 0.038) / 100) * 100,
        low: stock.base - Math.round((stock.base * 0.01) / 100) * 100,
        open: stock.base,
        volume: Math.round(stock.base * 105.2),
        receivedAt: Date.now(),
        source: "demo",
      };
    }
    const d = (await kis("inquire-price", "FHKST01010100", params(symbol)))
      .output;
    const price = Number(d.stck_prpr);
    if (!Number.isSafeInteger(price) || price <= 0)
      throw Error("유효한 시세가 없습니다.");
    return {
      symbol,
      price,
      change: Number(d.prdy_vrss),
      changeRate: Number(d.prdy_ctrt),
      high: Number(d.stck_hgpr),
      low: Number(d.stck_lwpr),
      open: Number(d.stck_oprc),
      volume: Number(d.acml_vol),
      receivedAt: Date.now(),
      source: "kis",
    };
  });
}
export async function candlePage(
  symbol: string,
  period = "D",
  before?: string,
): Promise<Candle[]> {
  const stock = known(symbol);
  return cached(
    "history:" + symbol + period + (before || "latest"),
    before ? 3600000 : 60000,
    async () => {
      const end = before
        ? new Date(Date.parse(before + "T00:00:00Z") - 86400000)
        : new Date();
      if (provider === "demo") {
        const bars: Candle[] = [];
        const stride = period === "W" ? 7 : period === "M" ? 30 : 1;
        for (let i = 99; i >= 0; i--) {
          const d = new Date(end.getTime() - i * stride * 86400000);
          const t = Math.floor(d.getTime() / 86400000);
          const close = Math.max(
            100,
            Math.round((stock.base * (1 + Math.sin(t / 19) * 0.12)) / 100) *
              100,
          );
          const open = Math.max(
            100,
            close + Math.round((Math.sin(t) * stock.base * 0.01) / 100) * 100,
          );
          bars.push({
            date: d.toISOString().slice(0, 10),
            open,
            close,
            high: Math.max(open, close) + 500,
            low: Math.max(1, Math.min(open, close) - 500),
            volume: Math.round((1 + Math.abs(Math.sin(t))) * 1000000),
          });
        }
        return bars;
      }
      const date = (d: Date) =>
        d.toISOString().slice(0, 10).replaceAll("-", "");
      const data = await kis("inquire-daily-itemchartprice", "FHKST03010100", {
        ...params(symbol),
        FID_INPUT_DATE_1: "19000101",
        FID_INPUT_DATE_2: date(end),
        FID_PERIOD_DIV_CODE: period,
        FID_ORG_ADJ_PRC: "0",
      });
      const unique = new Map<string, Candle>();
      for (const d of data.output2 || []) {
        if (!/^\d{8}$/.test(d.stck_bsop_date) || Number(d.stck_clpr) <= 0)
          continue;
        const day =
          d.stck_bsop_date.slice(0, 4) +
          "-" +
          d.stck_bsop_date.slice(4, 6) +
          "-" +
          d.stck_bsop_date.slice(6, 8);
        if (before && day >= before) continue;
        unique.set(day, {
          date: day,
          open: Number(d.stck_oprc),
          high: Number(d.stck_hgpr),
          low: Number(d.stck_lwpr),
          close: Number(d.stck_clpr),
          volume: Number(d.acml_vol),
        });
      }
      return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
    },
  );
}
export async function candles(symbol: string, period = "D"): Promise<Candle[]> {
  return cached("c" + symbol + period, 60000, async () => {
    const recent = await candlePage(symbol, period);
    if (!recent.length) return recent;
    const older = await candlePage(symbol, period, recent[0].date);
    return [...older, ...recent];
  });
}
export async function book(symbol: string): Promise<Book> {
  known(symbol);
  const live = realtime.books.get(symbol);
  if (live && Date.now() - live.receivedAt < 10000) return live;
  return cached("b" + symbol, 10000, async () => {
    if (provider === "demo") {
      const q = await quote(symbol);
      return {
        receivedAt: Date.now(),
        asks: Array.from({ length: 10 }, (_, i) => ({
          price: q.price + (i + 1) * 100,
          quantity: 3200 + i * 831,
        })),
        bids: Array.from({ length: 10 }, (_, i) => ({
          price: q.price - i * 100,
          quantity: 2700 + i * 621,
        })),
      };
    }
    const d = (
      await kis("inquire-asking-price-exp-ccn", "FHKST01010200", params(symbol))
    ).output1;
    return {
      receivedAt: Date.now(),
      asks: Array.from({ length: 10 }, (_, i) => ({
        price: Number(d["askp" + (i + 1)]),
        quantity: Number(d["askp_rsqn" + (i + 1)]),
      })),
      bids: Array.from({ length: 10 }, (_, i) => ({
        price: Number(d["bidp" + (i + 1)]),
        quantity: Number(d["bidp_rsqn" + (i + 1)]),
      })),
    };
  });
}
