import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readWorkspaceLocation,
  workspaceUrl,
} from "../src/workspaceNavigation";
test("화면·종목·탭·검색·분석 조건을 링크로 왕복한다", () => {
  const initial = readWorkspaceLocation("https://example.test/");
  const view = {
    ...initial,
    page: "analysis",
    symbol: "0182S0",
    period: "W",
    tradeTab: "news" as const,
    accountTab: "pending",
    search: "반도체 삼성",
    onlyStars: true,
    marketFilter: "KOSPI",
    instrumentFilter: "stock",
    themeFilter: "004",
    stockPage: 3,
    analysis: {
      tab: "themes" as const,
      market: "KOSDAQ" as const,
      date: "2026-09-10",
      metric: "turnover" as const,
      search: "2차전지",
      page: 2,
    },
  };
  assert.deepEqual(
    readWorkspaceLocation(
      new URL(
        workspaceUrl(view, "https://example.test/"),
        "https://example.test",
      ).href,
    ),
    view,
  );
});
test("잘못된 주소 매개변수는 기본값으로 정규화한다", () => {
  const view = readWorkspaceLocation(
    "https://example.test/?page=oops&symbol=../../.env&tab=unknown&period=X&stockPage=-5&account=bad&metric=invalid",
  );
  assert.equal(view.page, "trade");
  assert.equal(view.symbol, "005930");
  assert.equal(view.tradeTab, "chart");
  assert.equal(view.period, "D");
  assert.equal(view.stockPage, 0);
  assert.equal(view.accountTab, "holdings");
  assert.equal(view.analysis.metric, "upper");
  assert.equal(view.analysis.tab, "stocks");
});
test("종목 분석 링크는 새로고침과 탐색에서 탭과 종목을 유지한다", () => {
  const url = "https://example.test/?page=trade&symbol=000660&tab=financials";
  const view = readWorkspaceLocation(url);
  assert.equal(view.tradeTab, "financials");
  assert.equal(
    workspaceUrl(view, url),
    "/?page=trade&symbol=000660&tab=financials",
  );
});
test("교육 주차 링크를 유지하며 다른 화면으로 이동하면 교육 해시를 제거한다", () => {
  const url = "https://example.test/?page=trade#education/week/5";
  const view = readWorkspaceLocation(url);
  assert.equal(view.page, "education");
  assert.ok(workspaceUrl(view, url).endsWith("#education/week/5"));
  assert.ok(
    !workspaceUrl({ ...view, page: "account" }, url).includes("#education"),
  );
});
