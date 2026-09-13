export type FinancialPeriod = "annual" | "quarter";
export type FinancialKind = "income" | "balance" | "ratios" | "valuation";
export type FinancialRow = {
  date: string;
  revenue: number | null;
  costOfSales: number | null;
  grossProfit: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
  currentAssets: number | null;
  fixedAssets: number | null;
  assets: number | null;
  currentLiabilities: number | null;
  fixedLiabilities: number | null;
  liabilities: number | null;
  equity: number | null;
  roe: number | null;
  eps: number | null;
  bps: number | null;
  debtRatio: number | null;
};
export type FinancialMetric = Exclude<keyof FinancialRow, "date">;
export type Valuation = {
  fiscalMonth: number | null;
  price: number | null;
  marketCap: number | null;
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  foreignOwnership: number | null;
  listedShares: number | null;
  high52: number | null;
  low52: number | null;
};
export type FinancialSection = {
  kind: FinancialKind;
  status: "ok" | "empty" | "error" | "stale";
  receivedAt: number | null;
};
export type StockFinancials = {
  symbol: string;
  period: FinancialPeriod;
  source: "kis" | "demo";
  amountUnit: "억원";
  accountingBasis: "provider-unspecified";
  interimDates: string[];
  rows: FinancialRow[];
  valuation: Valuation | null;
  sections: FinancialSection[];
};

export const financialLabels: Record<FinancialMetric, string> = {
  revenue: "매출액",
  costOfSales: "매출원가",
  grossProfit: "매출총이익",
  operatingProfit: "영업이익",
  netIncome: "당기순이익",
  currentAssets: "유동자산",
  fixedAssets: "고정자산",
  assets: "자산총계",
  currentLiabilities: "유동부채",
  fixedLiabilities: "고정부채",
  liabilities: "부채총계",
  equity: "자본총계",
  roe: "ROE",
  eps: "EPS",
  bps: "BPS",
  debtRatio: "부채비율",
};

export const sectionLabels: Record<FinancialKind, string> = {
  income: "손익계산서",
  balance: "재무상태표",
  ratios: "재무비율",
  valuation: "투자지표",
};

export function financialDate(date: string) {
  return date.slice(0, 4) + "." + date.slice(4, 6);
}
export function margin(profit: number | null, revenue: number | null) {
  return profit !== null && revenue !== null && revenue > 0
    ? (profit / revenue) * 100
    : null;
}
export function yearComparison(
  current: number | null,
  previous: number | null,
  profit = false,
): string {
  if (current === null || previous === null) return "전년 동기 비교 자료 없음";
  if (profit && previous < 0)
    return current > 0
      ? "전년 동기 대비 흑자 전환"
      : current < 0
        ? "전년 동기 대비 적자 지속"
        : "전년 동기 대비 손익분기";
  if (profit && previous > 0 && current < 0) return "전년 동기 대비 적자 전환";
  if (previous <= 0) return "전년 동기 증감률 계산 불가";
  const rate = (current / previous - 1) * 100;
  return "전년 동기 " + (rate > 0 ? "+" : "") + rate.toFixed(1) + "%";
}
