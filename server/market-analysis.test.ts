import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MarketAnalysisStore,
  mergeLimitHits,
  parseAnalysisStocks,
} from "./market-analysis";
import {
  analysisMetrics,
  type AnalysisSection,
  type AnalysisStock,
  type MarketAnalysisReport,
} from "../src/marketAnalysisTypes";
import type { Stock } from "../src/types";
const catalog: Stock[] = [
  {
    symbol: "005930",
    name: "삼성전자",
    market: "KOSPI",
    sector: "주식",
    base: 10000,
  },
];
const raw = {
  mksc_shrn_iscd: "005930",
  stck_prpr: "12950",
  stck_mxpr: "12950",
  stck_llam: "7000",
  prdy_ctrt: "29.5",
  acml_vol: "500",
  prdy_vol: "0",
};
const stock: AnalysisStock = {
  symbol: "005930",
  name: "삼성전자",
  market: "KOSPI",
  price: 12950,
  changeRate: 29.5,
  volume: 500,
  turnover: null,
  volumeRatio: null,
  upperPrice: 12950,
  lowerPrice: 7000,
};
const section = (
  rows: AnalysisStock[],
  collectedAt = "2026-09-09T01:00:00.000Z",
  error: string | null = null,
): AnalysisSection => ({ rows, collectedAt, error });
function report(date = "2026-09-09"): MarketAnalysisReport {
  return {
    date,
    market: "ALL",
    source: "demo",
    collectedAt: date + "T01:00:00.000Z",
    indices: [],
    indexError: false,
    sections: Object.fromEntries(
      Object.keys(analysisMetrics).map((key) => [
        key,
        section(key === "upper" ? [stock] : [], date + "T01:00:00.000Z"),
      ]),
    ) as MarketAnalysisReport["sections"],
    upperHits: [],
    lowerHits: [],
  };
}

test("상한가 판정은 30% 추정이 아닌 제공 상한가격 일치, 결측값은 null", () => {
  assert.deepEqual(parseAnalysisStocks([raw], "upper", catalog), [stock]);
  assert.equal(
    parseAnalysisStocks(
      [{ ...raw, stck_prpr: "12900", prdy_ctrt: "30" }],
      "upper",
      catalog,
    ).length,
    0,
  );
  assert.equal(
    parseAnalysisStocks([{ ...raw, stck_mxpr: undefined }], "upper", catalog)
      .length,
    0,
  );
  assert.equal(
    parseAnalysisStocks(
      [{ ...raw, mksc_shrn_iscd: "999999" }],
      "upper",
      catalog,
    ).length,
    0,
  );
  assert.throws(() =>
    parseAnalysisStocks([{ ...raw, stck_prpr: "invalid" }], "upper", catalog),
  );
  assert.throws(() => parseAnalysisStocks({}, "upper", catalog));
});
test("상한가 이탈 후에도 최초 포착 보존, 실패 시 현재 상태 불명", () => {
  const initial = mergeLimitHits([], section([stock]));
  const escaped = mergeLimitHits(
    initial,
    section([], "2026-09-09T02:00:00.000Z"),
  );
  assert.equal(escaped[0].active, false);
  assert.equal(escaped[0].firstSeen, initial[0].firstSeen);
  const failed = mergeLimitHits(
    initial,
    section([], "2026-09-09T02:00:00.000Z", "unavailable"),
  );
  assert.equal(failed[0].active, null);
  const returned = mergeLimitHits(
    escaped,
    section([stock], "2026-09-09T03:00:00.000Z"),
  );
  assert.equal(returned[0].active, true);
  assert.equal(returned[0].firstSeen, initial[0].firstSeen);
  assert.equal(returned[0].lastSeen, "2026-09-09T03:00:00.000Z");
});
test("일별 분석 영속 저장·날짜 전환·동시 수집 공유·실패 시 이전 시각 유지", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amicom-analysis-"));
  try {
    let now = Date.parse("2026-09-09T01:00:00Z"),
      calls = 0,
      offline = false,
      day = "2026-09-09";
    const store = new MarketAnalysisStore(
      dir,
      async () => {
        calls++;
        if (offline) throw Error("offline");
        return report(day);
      },
      () => now,
    );
    const [first, second] = await Promise.all([
      store.get("ALL"),
      store.get("ALL"),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(first, second);
    assert.equal(first.report.upperHits.length, 1);
    now += 60001;
    day = "2026-09-10";
    const next = await store.get("ALL");
    assert.deepEqual(next.dates, ["2026-09-10", "2026-09-09"]);
    assert.equal(
      (await store.get("ALL", "2026-09-09")).report.date,
      "2026-09-09",
    );
    assert.equal(
      next.report.upperHits[0].firstSeen,
      "2026-09-10T01:00:00.000Z",
    );
    now += 60001;
    offline = true;
    const stale = await store.get("ALL");
    assert.equal(stale.stale, true);
    assert.equal(stale.report.collectedAt, next.report.collectedAt);
    const restored = new MarketAnalysisStore(dir, async () => {
      throw Error("offline");
    });
    assert.equal((await restored.get("ALL")).report.date, day);
    await assert.rejects(store.get("ALL", "2026-09-01"));
    await assert.rejects(store.get("ALL", "../../secret"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
