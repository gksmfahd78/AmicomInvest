import { test } from "node:test";
import assert from "node:assert/strict";
import { briefingCandidates, briefingArticles } from "../src/marketNews";
import {
  analysisMetrics,
  type AnalysisStock,
  type MarketAnalysisReport,
} from "../src/marketAnalysisTypes";
import type { StockNewsResponse } from "../src/newsTypes";
const row = (
  symbol: string,
  rate: number,
  turnover: number | null,
): AnalysisStock => ({
  symbol,
  name: symbol,
  market: "KOSPI",
  changeRate: rate,
  turnover,
  price: 100,
  volume: 10,
  volumeRatio: 1,
  upperPrice: 130,
  lowerPrice: 70,
});
const a = row("005930", 5, 200),
  b = row("000660", 10, 100),
  c = row("035420", -1, null);
function report(): MarketAnalysisReport {
  return {
    date: "2026-09-09",
    market: "ALL",
    source: "demo",
    collectedAt: "2026-09-09T02:00:00Z",
    indices: [],
    indexError: false,
    upperHits: [
      { ...a, active: false, firstSeen: "", lastSeen: "" },
      { ...b, active: true, firstSeen: "", lastSeen: "" },
    ],
    lowerHits: [],
    sections: Object.fromEntries(
      Object.keys(analysisMetrics).map((key) => [
        key,
        { rows: [a, b, c], error: null, collectedAt: "2026-09-09T02:00:00Z" },
      ]),
    ) as MarketAnalysisReport["sections"],
  };
}
const available = new Set([a.symbol, b.symbol, c.symbol]);
test("브리핑은 중복 없이 거래대금·상승률·현재 상한가와 지원 종목을 구분한다", () => {
  assert.deepEqual(
    briefingCandidates(report(), "turnover", available).map((r) => r.symbol),
    [a.symbol, b.symbol],
  );
  assert.deepEqual(
    briefingCandidates(report(), "gainers", available).map((r) => r.symbol),
    [b.symbol, a.symbol],
  );
  assert.deepEqual(
    briefingCandidates(report(), "upper", available).map((r) => r.symbol),
    [b.symbol],
  );
  assert.deepEqual(
    briefingCandidates(report(), "upper", new Set([a.symbol])),
    [],
  );
});
test("브리핑은 장애 표본과 다른 시장을 제외하고 8종목까지만 조회한다", () => {
  const r = report();
  r.market = "KOSDAQ";
  assert.deepEqual(briefingCandidates(r, "turnover", available), []);
  r.market = "ALL";
  for (const section of Object.values(r.sections)) section.error = "지연";
  assert.deepEqual(briefingCandidates(r, "turnover", available), []);
  r.sections.turnover.error = null;
  r.sections.turnover.rows = Array.from({ length: 12 }, (_, i) =>
    row(String(i), i, i),
  );
  assert.equal(
    briefingCandidates(
      r,
      "turnover",
      new Set(r.sections.turnover.rows.map((r) => r.symbol)),
    ).length,
    8,
  );
});
test("브리핑 뉴스는 선택한 KST 거래일과 유형을 함께 필터링한다", () => {
  const news: StockNewsResponse = {
    symbol: a.symbol,
    name: a.name,
    stale: false,
    updatedAt: "2026-09-09T02:00:00Z",
    unavailableFeeds: [],
    articles: [
      {
        title: "삼성전자 실적 개선",
        source: "매일경제",
        url: "https://www.mk.co.kr/news/stock/1",
        publishedAt: "2026-09-08T16:00:00Z",
      },
      {
        title: "삼성전자 배당 발표",
        source: "매일경제",
        url: "https://www.mk.co.kr/news/stock/2",
        publishedAt: "2026-09-09T02:00:00Z",
      },
      {
        title: "삼성전자 실적 발표",
        source: "매일경제",
        url: "https://www.mk.co.kr/news/stock/3",
        publishedAt: "2026-09-08T02:00:00Z",
      },
    ],
  };
  assert.equal(briefingArticles(news, "2026-09-09", "all").length, 2);
  assert.deepEqual(briefingArticles(news, "2026-09-09", "earnings"), [
    news.articles[0],
  ]);
  assert.equal(briefingArticles(news, "2025-09-09", "all").length, 0);
  assert.equal(briefingArticles(undefined, "2026-09-09", "all").length, 0);
});

test("하한가 브리핑은 현재 상태만 포함하고 하락폭순으로 정렬한다", () => {
  const r = report();
  const d = row("123456", -29.8, 50);
  for (const section of Object.values(r.sections)) section.rows.push(d);
  r.lowerHits = [
    { ...a, active: false, firstSeen: "", lastSeen: "" },
    { ...b, active: null, firstSeen: "", lastSeen: "" },
    { ...c, active: true, firstSeen: "", lastSeen: "" },
    { ...d, active: true, firstSeen: "", lastSeen: "" },
  ];
  assert.deepEqual(
    briefingCandidates(r, "lower", new Set([...available, d.symbol])).map(
      (row) => row.symbol,
    ),
    [d.symbol, c.symbol],
  );
  assert.deepEqual(
    briefingCandidates(r, "lower", available).map((row) => row.symbol),
    [c.symbol],
  );
  r.lowerHits = [];
  assert.deepEqual(briefingCandidates(r, "lower", available), []);
});
