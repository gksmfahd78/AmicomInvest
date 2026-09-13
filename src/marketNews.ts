import { analysisUniverse } from "./analysisInsights";
import type { MarketAnalysisReport } from "./marketAnalysisTypes";
import type { StockNewsResponse } from "./newsTypes";
import { classifyNews, newsDay, type NewsCategory } from "./newsAnalysis";
export type BriefingMode = "turnover" | "gainers" | "upper" | "lower";
export function briefingCandidates(
  report: MarketAnalysisReport,
  mode: BriefingMode,
  available: Set<string>,
) {
  const rows = analysisUniverse(report).filter((row) =>
    available.has(row.symbol),
  );
  const active = new Set(
    (mode === "lower" ? report.lowerHits : report.upperHits)
      .filter((hit) => hit.active === true)
      .map((hit) => hit.symbol),
  );
  return rows
    .filter((row) =>
      mode === "upper" || mode === "lower"
        ? active.has(row.symbol)
        : mode === "gainers"
          ? row.changeRate > 0
          : row.turnover !== null,
    )
    .sort(
      (a, b) =>
        (mode === "turnover"
          ? (b.turnover ?? 0) - (a.turnover ?? 0)
          : mode === "lower"
            ? a.changeRate - b.changeRate
            : b.changeRate - a.changeRate) || a.symbol.localeCompare(b.symbol),
    )
    .slice(0, 8);
}
export function briefingArticles(
  data: StockNewsResponse | undefined,
  date: string,
  category: NewsCategory | "all",
) {
  return (data?.articles ?? []).filter(
    (article) =>
      (!date || newsDay(article.publishedAt) === date) &&
      (category === "all" ||
        classifyNews(article.title).some((tag) => tag.category === category)),
  );
}
