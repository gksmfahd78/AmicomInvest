import {
  analysisMetrics,
  type AnalysisMarket,
  type AnalysisMetric,
} from "./marketAnalysisTypes";
export type AnalysisView = {
  tab: "overview" | "stocks" | "themes" | "news";
  market: AnalysisMarket;
  date: string;
  metric: AnalysisMetric;
  search: string;
  page: number;
};
export type WorkspaceLocation = {
  page: string;
  symbol: string;
  period: string;
  tradeTab: "chart" | "book" | "order" | "financials" | "news";
  accountTab: string;
  search: string;
  onlyStars: boolean;
  marketFilter: string;
  instrumentFilter: string;
  themeFilter: string;
  stockPage: number;
  analysis: AnalysisView;
};
const pick = <T extends string>(
  value: string | null,
  options: readonly T[],
  fallback: T,
): T => (options.includes(value as T) ? (value as T) : fallback);
const pageNumber = (value: string | null) =>
  /^\d+$/.test(value || "") ? Math.min(100000, Number(value)) : 0;
export function readWorkspaceLocation(href: string): WorkspaceLocation {
  const url = new URL(href),
    q = url.searchParams;
  const symbol = q.get("symbol") || "005930";
  const date = q.get("analysisDate") || "";
  return {
    page: url.hash.startsWith("#education")
      ? "education"
      : pick(
          q.get("page"),
          ["trade", "analysis", "account", "ranking", "admin", "education"],
          "trade",
        ),
    symbol: /^[A-Z0-9]{6}$/.test(symbol) ? symbol : "005930",
    period: pick(q.get("period"), ["D", "W", "M"], "D"),
    tradeTab: pick(
      q.get("tab"),
      ["chart", "book", "order", "financials", "news"],
      "chart",
    ),
    accountTab: pick(
      q.get("account"),
      ["holdings", "pending", "orders", "performance"],
      "holdings",
    ),
    search: (q.get("q") || "").slice(0, 100),
    onlyStars: q.get("stars") === "1",
    marketFilter: pick(q.get("market"), ["ALL", "KOSPI", "KOSDAQ"], "ALL"),
    instrumentFilter: pick(q.get("instrument"), ["ALL", "stock", "etf"], "ALL"),
    themeFilter: (q.get("theme") || "ALL").slice(0, 40),
    stockPage: pageNumber(q.get("stockPage")),
    analysis: {
      tab: pick(
        q.get("analysisTab"),
        ["overview", "stocks", "themes", "news"],
        "stocks",
      ),
      market: pick(q.get("analysisMarket"), ["ALL", "KOSPI", "KOSDAQ"], "ALL"),
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
      metric: pick(
        q.get("metric"),
        Object.keys(analysisMetrics) as AnalysisMetric[],
        "upper",
      ),
      search: (q.get("aq") || "").slice(0, 100),
      page: pageNumber(q.get("analysisPage")),
    },
  };
}
export function workspaceUrl(state: WorkspaceLocation, href: string) {
  const url = new URL(href);
  const values: Record<string, string> = {
    page: state.page,
    symbol: state.symbol === "005930" ? "" : state.symbol,
    period: state.period === "D" ? "" : state.period,
    tab: state.tradeTab === "chart" ? "" : state.tradeTab,
    account: state.accountTab === "holdings" ? "" : state.accountTab,
    q: state.search,
    stars: state.onlyStars ? "1" : "",
    market: state.marketFilter === "ALL" ? "" : state.marketFilter,
    instrument: state.instrumentFilter === "ALL" ? "" : state.instrumentFilter,
    theme: state.themeFilter === "ALL" ? "" : state.themeFilter,
    stockPage: state.stockPage ? String(state.stockPage) : "",
    analysisMarket:
      state.analysis.market === "ALL" ? "" : state.analysis.market,
    analysisDate: state.analysis.date,
    analysisTab: state.analysis.tab === "stocks" ? "" : state.analysis.tab,
    metric: state.analysis.metric === "upper" ? "" : state.analysis.metric,
    aq: state.analysis.search,
    analysisPage: state.analysis.page ? String(state.analysis.page) : "",
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (state.page === "education") {
    if (!url.hash.startsWith("#education")) url.hash = "education/week/1";
  } else if (url.hash.startsWith("#education")) url.hash = "";
  return url.pathname + url.search + url.hash;
}
