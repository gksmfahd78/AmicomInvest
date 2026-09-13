import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { kis, kospiClose, provider, stocks } from "./market";
import {
  analysisMetrics,
  type AnalysisMarket,
  type AnalysisMetric,
  type AnalysisStock,
  type AnalysisIndex,
  type AnalysisSection,
  type LimitHit,
  type MarketAnalysisReport,
  type MarketAnalysisResponse,
} from "../src/marketAnalysisTypes";
import type { Stock } from "../src/types";

export const koreanDay = (now = Date.now()) =>
  new Date(now + 9 * 3600000).toISOString().slice(0, 10);
const metrics = Object.keys(analysisMetrics) as AnalysisMetric[];
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === "")
    return null;
  const parsed = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const nonnegative = (value: unknown) => {
  const n = num(value);
  return n !== null && n >= 0 ? n : null;
};

export function parseAnalysisStocks(
  output: unknown,
  metric: AnalysisMetric,
  catalog: Stock[],
): AnalysisStock[] {
  if (!Array.isArray(output))
    throw Error("분석 응답 형식이 올바르지 않습니다.");
  const known = new Map(catalog.map((s) => [s.symbol, s]));
  const unique = new Map<string, AnalysisStock>();
  for (const raw of output) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const symbol = String(row.mksc_shrn_iscd ?? row.stck_shrn_iscd ?? "");
    const stock = known.get(symbol),
      price = num(row.stck_prpr),
      rate = num(row.prdy_ctrt);
    if (!stock) continue; // Excludes instruments outside the application's stock catalog.
    if (price === null || price <= 0 || rate === null)
      throw Error("분석 시세에 누락된 값이 있습니다.");
    const upperPrice = nonnegative(row.stck_mxpr),
      lowerPrice = nonnegative(row.stck_llam);
    if (metric === "upper" && !(upperPrice && price === upperPrice)) continue;
    if (metric === "lower" && !(lowerPrice && price === lowerPrice)) continue;
    const volume = nonnegative(row.acml_vol),
      previousVolume = nonnegative(row.prdy_vol);
    unique.set(symbol, {
      symbol,
      name: stock.name,
      market: stock.market,
      price,
      changeRate: rate,
      volume,
      turnover: nonnegative(row.acml_tr_pbmn),
      volumeRatio:
        volume !== null && previousVolume ? volume / previousVolume : null,
      upperPrice,
      lowerPrice,
    });
  }
  const rows = [...unique.values()];
  const score = (s: AnalysisStock) =>
    metric === "volume"
      ? s.volume
      : metric === "turnover"
        ? s.turnover
        : metric === "surge"
          ? s.volumeRatio
          : s.changeRate;
  return rows
    .filter((s) => metric !== "gainers" || s.changeRate > 0)
    .filter((s) => metric !== "losers" || s.changeRate < 0)
    .sort((a, b) =>
      metric === "losers"
        ? a.changeRate - b.changeRate
        : (score(b) ?? -Infinity) - (score(a) ?? -Infinity),
    );
}
export function mergeLimitHits(
  previous: LimitHit[],
  section: AnalysisSection,
): LimitHit[] {
  const hits = new Map<string, LimitHit>(
    previous.map(
      (hit) =>
        [hit.symbol, { ...hit, active: section.error ? null : false }] as const,
    ),
  );
  if (!section.error)
    for (const row of section.rows) {
      const old = hits.get(row.symbol);
      hits.set(row.symbol, {
        ...row,
        firstSeen: old?.firstSeen ?? section.collectedAt,
        lastSeen: section.collectedAt,
        active: true,
      });
    }
  return [...hits.values()].sort(
    (a, b) =>
      Number(b.active === true) - Number(a.active === true) ||
      a.firstSeen.localeCompare(b.firstSeen),
  );
}
function parseIndex(
  output: unknown,
  market: "KOSPI" | "KOSDAQ",
): AnalysisIndex {
  const row = output as Record<string, unknown>;
  const value = num(row?.bstp_nmix_prpr),
    changeRate = num(row?.bstp_nmix_prdy_ctrt);
  if (value === null || value <= 0 || changeRate === null)
    throw Error("지수 조회 실패");
  return {
    market,
    value,
    changeRate,
    rising: nonnegative(row.ascn_issu_cnt),
    falling: nonnegative(row.down_issu_cnt),
    unchanged: nonnegative(row.stnr_issu_cnt),
    upper: nonnegative(row.uplm_issu_cnt),
    lower: nonnegative(row.lslm_issu_cnt),
  };
}

async function ranking(metric: AnalysisMetric, market: AnalysisMarket) {
  const common = {
    FID_COND_MRKT_DIV_CODE: "J",
    FID_INPUT_ISCD:
      market === "KOSPI" ? "0001" : market === "KOSDAQ" ? "1001" : "0000",
    FID_TRGT_CLS_CODE: "0",
    FID_TRGT_EXLS_CLS_CODE: "0",
    FID_INPUT_PRICE_1: "",
    FID_INPUT_PRICE_2: "",
    FID_VOL_CNT: "",
  };
  if (metric === "upper" || metric === "lower")
    return (
      await kis("capture-uplowprice", "FHKST130000C0", {
        ...common,
        FID_COND_SCR_DIV_CODE: "11300",
        FID_PRC_CLS_CODE: metric === "upper" ? "0" : "1",
        FID_DIV_CLS_CODE: "0",
      })
    ).output;
  if (metric === "gainers" || metric === "losers")
    return (
      await kis(
        "fluctuation",
        "FHPST01700000",
        {
          ...common,
          FID_COND_SCR_DIV_CODE: "20170",
          FID_RANK_SORT_CLS_CODE: metric === "gainers" ? "0" : "1",
          FID_INPUT_CNT_1: "0",
          FID_PRC_CLS_CODE: "0",
          FID_DIV_CLS_CODE: "0",
          FID_RSFL_RATE1: "",
          FID_RSFL_RATE2: "",
        },
        "ranking",
      )
    ).output;
  return (
    await kis("volume-rank", "FHPST01710000", {
      ...common,
      FID_TRGT_CLS_CODE: "111111111",
      FID_TRGT_EXLS_CLS_CODE: "0000000000",
      FID_COND_SCR_DIV_CODE: "20171",
      FID_DIV_CLS_CODE: "0",
      FID_BLNG_CLS_CODE:
        metric === "turnover" ? "3" : metric === "surge" ? "1" : "0",
      FID_INPUT_DATE_1: "",
    })
  ).output;
}
function demoReport(market: AnalysisMarket): MarketAnalysisReport {
  const collectedAt = new Date().toISOString();
  const selected = stocks
    .filter((s) => market === "ALL" || s.market === market)
    .slice(0, 30);
  const rows = selected.map((s, i): AnalysisStock => ({
    symbol: s.symbol,
    name: s.name,
    market: s.market,
    price: Math.max(
      100,
      Math.round(s.base * (i === 0 ? 1.3 : i === 1 ? 0.7 : 1 + (12 - i) / 100)),
    ),
    changeRate: i === 0 ? 30 : i === 1 ? -30 : 12 - i,
    volume: (30 - i) * 123450,
    turnover: (30 - i) * 123450 * s.base,
    volumeRatio: (30 - i) / 5,
    upperPrice: Math.round(s.base * 1.3),
    lowerPrice: Math.round(s.base * 0.7),
  }));
  const sections = Object.fromEntries(
    metrics.map((metric) => [
      metric,
      {
        collectedAt,
        error: null,
        rows:
          metric === "upper"
            ? rows.slice(0, 1)
            : metric === "lower"
              ? rows.slice(1, 2)
              : [...rows]
                  .filter((r) =>
                    metric === "gainers"
                      ? r.changeRate > 0
                      : metric === "losers"
                        ? r.changeRate < 0
                        : true,
                  )
                  .sort((a, b) =>
                    metric === "losers"
                      ? a.changeRate - b.changeRate
                      : metric === "gainers"
                        ? b.changeRate - a.changeRate
                        : metric === "turnover"
                          ? b.turnover! - a.turnover!
                          : metric === "surge"
                            ? b.volumeRatio! - a.volumeRatio!
                            : b.volume! - a.volume!,
                  ),
      },
    ]),
  ) as MarketAnalysisReport["sections"];
  return {
    date: koreanDay(),
    market,
    source: "demo",
    collectedAt,
    indices: [
      {
        market: "KOSPI",
        value: 2654.32,
        changeRate: 1.23,
        rising: 532,
        falling: 321,
        unchanged: 48,
        upper: 3,
        lower: 1,
      },
      {
        market: "KOSDAQ",
        value: 842.15,
        changeRate: -0.64,
        rising: 624,
        falling: 854,
        unchanged: 91,
        upper: 5,
        lower: 2,
      },
    ],
    indexError: false,
    sections,
    upperHits: [],
    lowerHits: [],
  };
}
export async function collectMarketAnalysis(
  market: AnalysisMarket,
): Promise<MarketAnalysisReport> {
  if (provider === "demo") return demoReport(market);
  // Anchor snapshots to the exchange's actual trading date, including holidays.
  const { date } = await kospiClose();
  const results = await Promise.allSettled(
    metrics.map(async (metric) =>
      parseAnalysisStocks(await ranking(metric, market), metric, stocks),
    ),
  );
  if (results.every((result) => result.status === "rejected"))
    throw Error("시장 분석 시세를 불러오지 못했습니다.");
  const indexResults = await Promise.allSettled(
    (["KOSPI", "KOSDAQ"] as const).map(async (name) =>
      parseIndex(
        (
          await kis("inquire-index-price", "FHPUP02100000", {
            FID_COND_MRKT_DIV_CODE: "U",
            FID_INPUT_ISCD: name === "KOSPI" ? "0001" : "1001",
          })
        ).output,
        name,
      ),
    ),
  );
  const collectedAt = new Date().toISOString();
  return {
    date,
    market,
    source: "kis",
    collectedAt,
    indices: indexResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    ),
    indexError: indexResults.some((result) => result.status === "rejected"),
    sections: Object.fromEntries(
      metrics.map((metric, i) => {
        const result = results[i];
        return [
          metric,
          {
            collectedAt,
            rows: result.status === "fulfilled" ? result.value : [],
            error:
              result.status === "rejected"
                ? "이 지표를 불러오지 못했습니다."
                : null,
          },
        ];
      }),
    ) as MarketAnalysisReport["sections"],
    upperHits: [],
    lowerHits: [],
  };
}

export function appendAnalysisHistory(
  previous: MarketAnalysisReport | null,
  report: MarketAnalysisReport,
) {
  const history =
    previous?.date === report.date ? [...(previous.history ?? [])] : [];
  // Old daily snapshots remain readable; start with their actual saved observation.
  if (!history.length && previous?.date === report.date)
    history.push({
      collectedAt: previous.collectedAt,
      indices: previous.indices,
      upperCount: previous.upperHits.length,
      lowerCount: previous.lowerHits.length,
    });
  const point = {
    collectedAt: report.collectedAt,
    indices: report.indices,
    upperCount: report.upperHits.length,
    lowerCount: report.lowerHits.length,
  };
  const last = history.at(-1);
  if (last && Date.parse(point.collectedAt) <= Date.parse(last.collectedAt))
    return history;
  if (
    last &&
    Math.floor(Date.parse(last.collectedAt) / 300000) ===
      Math.floor(Date.parse(point.collectedAt) / 300000)
  )
    history[history.length - 1] = point;
  else history.push(point);
  return history.slice(-300);
}

export class MarketAnalysisStore {
  private cache = new Map<
    AnalysisMarket,
    { report: MarketAnalysisReport; checked: number; stale: boolean }
  >();
  private pending = new Map<AnalysisMarket, Promise<MarketAnalysisResponse>>();
  constructor(
    private readonly directory = resolve("data/market-analysis", provider),
    private readonly collect = collectMarketAnalysis,
    private readonly now = Date.now,
  ) {}
  dates(market: AnalysisMarket): string[] {
    try {
      return readdirSync(this.directory)
        .filter((file) =>
          new RegExp("^\\d{4}-\\d{2}-\\d{2}-" + market + "\\.json$").test(file),
        )
        .map((file) => file.slice(0, 10))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }
  private read(
    date: string,
    market: AnalysisMarket,
  ): MarketAnalysisReport | null {
    try {
      const report = JSON.parse(
        readFileSync(
          resolve(this.directory, date + "-" + market + ".json"),
          "utf8",
        ),
      ) as MarketAnalysisReport;
      if (
        report.date !== date ||
        report.market !== market ||
        !report.sections ||
        !Array.isArray(report.upperHits) ||
        !Array.isArray(report.lowerHits)
      )
        return null;
      return report;
    } catch {
      return null;
    }
  }
  async get(
    market: AnalysisMarket,
    date?: string,
  ): Promise<MarketAnalysisResponse> {
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw Error("날짜 형식이 올바르지 않습니다.");
      const report = this.read(date, market);
      if (!report)
        throw Error(
          "이 날짜에는 저장된 분석이 없습니다. 수집을 시작한 날부터 확인할 수 있습니다.",
        );
      return { report, dates: this.dates(market), stale: false };
    }
    const hit = this.cache.get(market);
    if (hit && this.now() - hit.checked < 60000)
      return {
        report: hit.report,
        dates: this.dates(market),
        stale: hit.stale,
      };
    const running = this.pending.get(market);
    if (running) return running;
    const promise = this.update(market).finally(() =>
      this.pending.delete(market),
    );
    this.pending.set(market, promise);
    return promise;
  }
  private async update(
    market: AnalysisMarket,
  ): Promise<MarketAnalysisResponse> {
    try {
      const report = await this.collect(market);
      const previous = this.read(report.date, market);
      report.upperHits = mergeLimitHits(
        previous?.upperHits ?? [],
        report.sections.upper,
      );
      report.lowerHits = mergeLimitHits(
        previous?.lowerHits ?? [],
        report.sections.lower,
      );
      report.history = appendAnalysisHistory(previous, report);
      mkdirSync(this.directory, { recursive: true });
      const path = resolve(
        this.directory,
        report.date + "-" + market + ".json",
      );
      writeFileSync(path + ".tmp", JSON.stringify(report));
      renameSync(path + ".tmp", path);
      this.cache.set(market, { report, checked: this.now(), stale: false });
      return { report, dates: this.dates(market), stale: false };
    } catch (error) {
      const report =
        this.cache.get(market)?.report ??
        this.read(this.dates(market)[0] ?? "", market);
      if (!report) throw error;
      this.cache.set(market, { report, checked: this.now(), stale: true });
      return { report, dates: this.dates(market), stale: true };
    }
  }
}
