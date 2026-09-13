import type { Stock, StockTheme } from "./types";

export function indexStockThemes(themes: StockTheme[]) {
  const index = new Map<string, StockTheme[]>();
  for (const theme of themes) {
    for (const symbol of theme.symbols) {
      const assigned = index.get(symbol) ?? [];
      if (!assigned.some((item) => item.code === theme.code))
        assigned.push(theme);
      index.set(symbol, assigned);
    }
  }
  return index;
}

export function matchesStockSearch(
  stock: Stock,
  themes: StockTheme[],
  query: string,
) {
  const searchable = [
    stock.name,
    stock.symbol,
    stock.instrument === "etf" ? "ETF 상장지수펀드" : "주식",
    ...themes.map((theme) => theme.name),
  ]
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
  return query
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .every((term) => searchable.includes(term));
}

export function matchesStockTheme(themes: StockTheme[], selected: string) {
  return (
    selected === "ALL" ||
    (selected === "UNCLASSIFIED"
      ? themes.length === 0
      : themes.some((theme) => theme.code === selected))
  );
}
