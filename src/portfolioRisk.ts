import type { Account, Stock, StockTheme } from "./types";

export function portfolioRisk(
  account: Account,
  stocks: Stock[],
  themes: StockTheme[],
) {
  const missing = account.holdings.filter(
    (h) => h.price === null || !Number.isFinite(h.price) || h.price! <= 0,
  );
  if (missing.length)
    return { complete: false as const, missing: missing.map((h) => h.name) };
  const total =
    account.cash +
    account.holdings.reduce((sum, h) => sum + h.quantity * h.price!, 0);
  const positions = account.holdings
    .map((h) => {
      const value = h.quantity * h.price!;
      const instrument =
        h.instrument ??
        stocks.find((s) => s.symbol === h.symbol)?.instrument ??
        "stock";
      const sector =
        stocks.find((s) => s.symbol === h.symbol)?.sector ?? "미분류";
      // The KIS master currently uses instrument groups, not industry sectors.
      const industry =
        instrument === "etf"
          ? "ETF · 구성 미분해"
          : [
                "주식",
                "외국주식",
                "주식예탁증서",
                "리츠",
                "투자회사",
                "선박투자회사",
                "인프라펀드",
              ].includes(sector)
            ? "업종 미분류"
            : sector;
      return {
        symbol: h.symbol,
        name: h.name,
        value,
        weight: total ? (value / total) * 100 : 0,
        pnl: value - h.cost,
        industry,
      };
    })
    .sort((a, b) => b.value - a.value);
  const industries = [...new Set(positions.map((p) => p.industry))]
    .map((name) => ({
      name,
      weight: positions
        .filter((p) => p.industry === name)
        .reduce((sum, p) => sum + p.weight, 0),
    }))
    .sort((a, b) => b.weight - a.weight);
  const exposures = themes
    .map((t) => {
      const members = positions.filter((p) => t.symbols.includes(p.symbol));
      return {
        code: t.code,
        name: t.name,
        members: members.map((p) => p.name),
        weight: members.reduce((sum, p) => sum + p.weight, 0),
      };
    })
    .filter((t) => t.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  return {
    complete: true as const,
    total,
    cashWeight: total ? (account.cash / total) * 100 : 0,
    positions,
    industries,
    exposures,
  };
}

/** Hypothetical full fill, valuing retained shares at the current account mark. */
export function projectedWeight(
  account: Account,
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  executionPrice: number,
  feeBps: number,
  taxBps: number,
  currentPrice: number,
) {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(executionPrice) ||
    executionPrice <= 0 ||
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0 ||
    account.holdings.some((h) => h.price === null)
  )
    return null;
  const held = account.holdings.find((h) => h.symbol === symbol);
  const currentQuantity = held?.quantity ?? 0;
  const nextQuantity =
    currentQuantity + (side === "buy" ? quantity : -quantity);
  const cost = quantity * executionPrice;
  const fees =
    Math.floor((cost * feeBps) / 10000) +
    (side === "sell" ? Math.floor((cost * taxBps) / 10000) : 0);
  const cash = account.cash + (side === "buy" ? -cost : cost) - fees;
  if (nextQuantity < 0 || cash < 0) return null;
  const other = account.holdings
    .filter((h) => h.symbol !== symbol)
    .reduce((sum, h) => sum + h.quantity * h.price!, 0);
  const value = nextQuantity * currentPrice;
  return cash + other + value > 0
    ? (value / (cash + other + value)) * 100
    : null;
}
