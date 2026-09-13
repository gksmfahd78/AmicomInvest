import { tickSize } from "../src/tradingRules";
import { realtime } from "./realtime";
import { readCatalog, downloadCatalog, CATALOG_VERSION } from "./catalog";
import type { Stock, Quote, Candle, Book } from "../src/types";
const sampleStocks: Stock[] = [
  {
    symbol: "069500",
    name: "KODEX 200",
    market: "KOSPI",
    sector: "ETF",
    instrument: "etf",
    base: 35000,
  },
  {
    symbol: "102110",
    name: "TIGER 200",
    market: "KOSPI",
    sector: "ETF",
    instrument: "etf",
    base: 35000,
  },
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
export let catalogNeedsRefresh = savedCatalog?.version !== CATALOG_VERSION;
function prioritize() {
  const priority = new Map(
    sampleStocks.map((s, i) => [
      s.symbol,
      s.instrument === "etf" ? 20 + i : i - 2,
    ]),
  );
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
      catalogNeedsRefresh = false;
      prioritize();
    })
    .finally(() => {
      syncing = undefined;
    });
  return syncing;
}
export const provider = process.env.MARKET_PROVIDER === "kis" ? "kis" : "demo";
export const marketDiagnostics = {
  requests: 0,
  successes: 0,
  failures: 0,
  lastSuccessAt: null as number | null,
  lastFailureAt: null as number | null,
  lastLatencyMs: null as number | null,
  lastPath: null as string | null,
  lastError: null as string | null,
};
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
  section: "quotations" | "ranking" | "finance" | "ksdinfo" = "quotations",
  product: "domestic-stock" | "etfetn" = "domestic-stock",
) {
  const operation = queue.then(async () => {
    const started = Date.now();
    marketDiagnostics.requests++;
    marketDiagnostics.lastPath = path;
    try {
      const access = await getToken();
      await new Promise((r) => setTimeout(r, 150));
      const res = await fetch(
        base +
          "/uapi/" +
          product +
          "/v1/" +
          section +
          "/" +
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
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.rt_cd !== "0") {
        const detail = data
          ? [data.msg_cd, data.msg1].filter(Boolean).join(" · ")
          : "JSON 응답을 읽을 수 없음";
        throw Error("KIS " + res.status + " · " + detail);
      }
      marketDiagnostics.successes++;
      marketDiagnostics.lastSuccessAt = Date.now();
      marketDiagnostics.lastLatencyMs = Date.now() - started;
      marketDiagnostics.lastError = null;
      return data;
    } catch (cause) {
      marketDiagnostics.failures++;
      marketDiagnostics.lastFailureAt = Date.now();
      marketDiagnostics.lastLatencyMs = Date.now() - started;
      marketDiagnostics.lastError = (
        cause instanceof Error ? cause.message : "알 수 없는 KIS 오류"
      ).slice(0, 240);
      throw Error(
        cause instanceof Error && cause.name === "TimeoutError"
          ? "실제 시세 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요."
          : "실제 시세를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
      );
    }
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
          ((Math.sin(
            Math.floor(Date.now() / 15000) / 19 +
              Number.parseInt(symbol, /^[0-9]+$/.test(symbol) ? 10 : 36),
          ) *
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

const koreaDate = (at = Date.now()) =>
  new Date(at + 9 * 3600000).toISOString().slice(0, 10);
export async function kospiClose(onOrBefore = koreaDate()) {
  return cached(
    "kospi:" + onOrBefore,
    onOrBefore === koreaDate() ? 60000 : 86400000,
    async () => {
      const target = new Date(onOrBefore + "T00:00:00Z");
      if (!Number.isFinite(target.getTime()))
        throw Error("KOSPI 기준일이 올바르지 않습니다.");
      if (provider === "demo") {
        const day = Math.floor(target.getTime() / 86400000);
        return {
          date: onOrBefore,
          value: Math.round((2650 + Math.sin(day / 17) * 120) * 100) / 100,
        };
      }
      const start = new Date(target.getTime() - 30 * 86400000)
        .toISOString()
        .slice(0, 10)
        .replaceAll("-", "");
      const data = await kis("inquire-daily-indexchartprice", "FHKUP03500100", {
        FID_COND_MRKT_DIV_CODE: "U",
        FID_INPUT_ISCD: "0001",
        FID_INPUT_DATE_1: start,
        FID_INPUT_DATE_2: onOrBefore.replaceAll("-", ""),
        FID_PERIOD_DIV_CODE: "D",
      });
      const row = (data.output2 || [])
        .filter(
          (item: Record<string, string>) =>
            /^\d{8}$/.test(item.stck_bsop_date) &&
            item.stck_bsop_date <= onOrBefore.replaceAll("-", "") &&
            Number(item.bstp_nmix_prpr) > 0,
        )
        .sort((a: Record<string, string>, b: Record<string, string>) =>
          b.stck_bsop_date.localeCompare(a.stck_bsop_date),
        )[0];
      if (!row) throw Error("KOSPI 기준 지수를 불러오지 못했습니다.");
      return {
        date:
          row.stck_bsop_date.slice(0, 4) +
          "-" +
          row.stck_bsop_date.slice(4, 6) +
          "-" +
          row.stck_bsop_date.slice(6, 8),
        value: Number(row.bstp_nmix_prpr),
      };
    },
  );
}

export async function book(symbol: string): Promise<Book> {
  const stock = known(symbol);
  const live = realtime.books.get(symbol);
  if (live && Date.now() - live.receivedAt < 10000) return live;
  return cached("b" + symbol, 10000, async () => {
    if (provider === "demo") {
      const q = await quote(symbol);
      const step = stock.instrument === "etf" ? tickSize(q.price, "etf") : 100;
      return {
        receivedAt: Date.now(),
        asks: Array.from({ length: 10 }, (_, i) => ({
          price: q.price + (i + 1) * step,
          quantity: 3200 + i * 831,
        })),
        bids: Array.from({ length: 10 }, (_, i) => ({
          price: q.price - i * step,
          quantity: 2700 + i * 621,
        })),
      };
    }
    const response = await kis(
      "inquire-asking-price-exp-ccn",
      "FHKST01010200",
      params(symbol),
    );
    const receivedAt = Date.now();
    const d = response.output1;
    // REST books do not include cumulative volume. Pair a current quote when available.
    const q = await quote(symbol).catch(() => null);
    return {
      receivedAt,
      exchangeTime: d.aspr_acpt_hour,
      marketPhase: d.new_mkop_cls_code,
      volume: q && Date.now() - q.receivedAt < 10000 ? q.volume : undefined,
      volumeDate: q?.tradingDate
        ? q.tradingDate.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")
        : koreaDate(),
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
