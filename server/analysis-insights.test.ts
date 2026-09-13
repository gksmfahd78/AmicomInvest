import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analysisUniverse,
  breadthPercent,
  defaultScreener,
  screenStocks,
  themeStrength,
} from "../src/analysisInsights";
import { appendAnalysisHistory } from "./market-analysis";
import {
  analysisMetrics,
  type MarketAnalysisReport,
  type AnalysisStock,
  type AnalysisSection,
} from "../src/marketAnalysisTypes";
const row = (
  symbol: string,
  rate = 5,
  value: number | null = 200e8,
): AnalysisStock => ({
  symbol,
  name: symbol,
  market: "KOSPI",
  price: 10000,
  changeRate: rate,
  volume: 1000,
  turnover: value,
  volumeRatio: 2,
  upperPrice: null,
  lowerPrice: null,
});
function report(at = "2026-09-09T01:00:00Z"): MarketAnalysisReport {
  return {
    date: "2026-09-09",
    market: "ALL",
    source: "demo",
    collectedAt: at,
    indices: [],
    indexError: false,
    upperHits: [],
    lowerHits: [],
    sections: Object.fromEntries(
      Object.keys(analysisMetrics).map((key): [string, AnalysisSection] => [
        key,
        { rows: [], error: null, collectedAt: at },
      ]),
    ) as MarketAnalysisReport["sections"],
  };
}
test("표본 중복 제거: 최신 관측값, 장애 지표와 과거 상한가 기록 제외", () => {
  const r = report();
  r.sections.gainers.rows = [row("a")];
  r.sections.turnover.rows = [row("a", 7)];
  r.sections.turnover.collectedAt = "2026-09-09T01:01:00Z";
  r.sections.volume.rows = [row("b")];
  r.sections.volume.error = "failed";
  r.upperHits = [
    {
      ...row("old"),
      firstSeen: r.collectedAt,
      lastSeen: r.collectedAt,
      active: false,
    },
  ];
  assert.deepEqual(
    analysisUniverse(r).map((s) => [s.symbol, s.changeRate]),
    [["a", 7]],
  );
  r.sections.surge.rows = [{ ...row("a", 8, null), volumeRatio: 4 }];
  r.sections.surge.collectedAt = r.sections.turnover.collectedAt;
  assert.equal(analysisUniverse(r)[0].turnover, 200e8);
  assert.equal(analysisUniverse(r)[0].volumeRatio, 4);
  r.market = "KOSDAQ";
  assert.equal(analysisUniverse(r).length, 0);
});
test("테마 중앙값·중복·거래대금 결측값과 최소 조건 필터", () => {
  const themes = [
    { code: "t", name: "테마", symbols: ["a", "b", "c", "c", "outside"] },
  ];
  const rows = [row("a", 30), row("b", -2, null), row("c", 1, 0)];
  const [t] = themeStrength(rows, themes);
  assert.equal(t.count, 3);
  assert.equal(t.totalMembers, 4);
  assert.equal(t.median, 1);
  assert.equal(t.turnover, 200e8);
  assert.equal(t.turnoverCount, 2);
  assert.equal(t.leader.symbol, "a");
  assert.deepEqual(
    screenStocks(rows, themes, {
      ...defaultScreener,
      theme: "t",
      minRate: "3",
      minTurnover: "100",
      minRatio: "2",
    }).map((s) => s.symbol),
    ["a"],
  );
  assert.deepEqual(
    screenStocks(rows, themes, { ...defaultScreener, minTurnover: "0" }).map(
      (s) => s.symbol,
    ),
    ["a", "c"],
  );
  assert.equal(
    screenStocks(rows, themes, { ...defaultScreener, theme: "unknown" }).length,
    0,
  );
  assert.equal(themeStrength([row("a", 1, null)], themes)[0].turnover, null);
  assert.equal(breadthPercent(1, 2, 1), 25);
  assert.equal(breadthPercent(1, null, 0), null);
  assert.equal(breadthPercent(0, 0, 0), null);
});
test("장중 기록: 기존 스냅샷 호환, 5분 버킷 갱신, 시간 역행·날짜 혼합 방지", () => {
  const old = report();
  const current = report("2026-09-09T01:06:00Z");
  current.history = appendAnalysisHistory(old, current);
  assert.equal(current.history.length, 2);
  assert.equal(current.history[0].collectedAt, old.collectedAt);
  const sameBucket = report("2026-09-09T01:07:00Z");
  sameBucket.history = appendAnalysisHistory(current, sameBucket);
  assert.equal(sameBucket.history.length, 2);
  assert.equal(sameBucket.history[1].collectedAt, sameBucket.collectedAt);
  assert.deepEqual(
    appendAnalysisHistory(sameBucket, current),
    sameBucket.history,
  );
  const next = report("2026-09-10T01:00:00Z");
  next.date = "2026-09-10";
  assert.equal(appendAnalysisHistory(sameBucket, next).length, 1);
});
