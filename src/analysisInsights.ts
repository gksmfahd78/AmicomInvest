import type {
  AnalysisStock,
  MarketAnalysisReport,
} from "./marketAnalysisTypes";
import type { StockTheme } from "./types";

// Ranking lists overlap. Use the freshest observation once per stock, excluding
// historical limit hits, whose prices may no longer describe the current sample.
export function analysisUniverse(
  report: MarketAnalysisReport,
): AnalysisStock[] {
  const unique = new Map<string, { row: AnalysisStock; at: string }>();
  for (const section of Object.values(report.sections)) {
    if (section.error) continue;
    for (const row of section.rows) {
      if (report.market !== "ALL" && row.market !== report.market) continue;
      const old = unique.get(row.symbol);
      if (!old || section.collectedAt > old.at)
        unique.set(row.symbol, { row, at: section.collectedAt });
      else if (section.collectedAt === old.at)
        unique.set(row.symbol, {
          at: old.at,
          row: {
            ...row,
            volume: row.volume ?? old.row.volume,
            turnover: row.turnover ?? old.row.turnover,
            volumeRatio: row.volumeRatio ?? old.row.volumeRatio,
            upperPrice: row.upperPrice ?? old.row.upperPrice,
            lowerPrice: row.lowerPrice ?? old.row.lowerPrice,
          },
        });
    }
  }
  return [...unique.values()].map((value) => value.row);
}
export function themeStrength(rows: AnalysisStock[], themes: StockTheme[]) {
  const known = new Map(rows.map((row) => [row.symbol, row]));
  return themes
    .map((theme) => {
      const members = [...new Set(theme.symbols)].flatMap((symbol) =>
        known.get(symbol) ? [known.get(symbol)!] : [],
      );
      const rates = members.map((row) => row.changeRate).sort((a, b) => a - b);
      const values = members.filter((row) => row.turnover !== null);
      return {
        code: theme.code,
        name: theme.name,
        members,
        count: members.length,
        totalMembers: new Set(theme.symbols).size,
        median: rates.length
          ? (rates[Math.floor((rates.length - 1) / 2)] +
              rates[Math.floor(rates.length / 2)]) /
            2
          : 0,
        rising: members.filter((row) => row.changeRate > 0).length,
        turnover: values.length
          ? values.reduce((sum, row) => sum + row.turnover!, 0)
          : null,
        turnoverCount: values.length,
        leader: [...members].sort((a, b) => b.changeRate - a.changeRate)[0],
      };
    })
    .filter((theme) => theme.count > 0);
}
export type ScreenerFilters = {
  minRate: string;
  minTurnover: string;
  minRatio: string;
  theme: string;
  sort: "turnover" | "changeRate" | "volumeRatio";
};
export const defaultScreener: ScreenerFilters = {
  minRate: "",
  minTurnover: "",
  minRatio: "",
  theme: "",
  sort: "turnover",
};
export function screenStocks(
  rows: AnalysisStock[],
  themes: StockTheme[],
  filter: ScreenerFilters,
) {
  const selected = themes.find((theme) => theme.code === filter.theme);
  const meets = (value: number | null, threshold: string, scale = 1) =>
    threshold.trim() === "" ||
    (value !== null &&
      Number.isFinite(Number(threshold)) &&
      value >= Number(threshold) * scale);
  return rows
    .filter(
      (row) =>
        (!filter.theme || Boolean(selected?.symbols.includes(row.symbol))) &&
        meets(row.changeRate, filter.minRate) &&
        meets(row.turnover, filter.minTurnover, 1e8) &&
        meets(row.volumeRatio, filter.minRatio),
    )
    .sort(
      (a, b) =>
        (b[filter.sort] ?? -Infinity) - (a[filter.sort] ?? -Infinity) ||
        a.symbol.localeCompare(b.symbol),
    );
}
export function breadthPercent(
  rising: number | null,
  falling: number | null,
  unchanged: number | null,
) {
  if (rising === null || falling === null || unchanged === null) return null;
  const total = rising + falling + unchanged;
  return total > 0 ? (rising / total) * 100 : null;
}
