import type { FinancialRow, StockFinancials } from "./financialTypes";

export type ResearchResult<T> = {
  status: "ok" | "empty" | "error" | "stale" | "unconfigured";
  data: T | null;
  receivedAt: number | null;
  source: "kis" | "dart" | "demo";
};
export type InvestorDay = {
  date: string;
  close: number | null;
  foreign: number | null;
  institution: number | null;
  individual: number | null;
};
export type InvestorFlows = { rows: InvestorDay[]; pendingDates: string[] };
export type EstimateRow = {
  date: string;
  estimated: boolean;
  revenue: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
};
export type Estimates = { asOf: string | null; rows: EstimateRow[] };
export type Dividend = {
  recordDate: string;
  payDate: string | null;
  stockPayDate: string | null;
  amount: number | null;
  stockRate: number | null;
  kind: string;
};
export type Dividends = { from: string; to: string; rows: Dividend[] };
export type CompanyProfile = {
  industry: string | null;
  industryCode: string | null;
  listedDate: string | null;
};
export type Peer = {
  symbol: string;
  name: string;
  profile: ResearchResult<CompanyProfile>;
  financials: StockFinancials;
};
export type PeerComparison = { date: string | null; companies: Peer[] };
export type Filing = {
  id: string;
  date: string;
  title: string;
  category: string;
  url: string;
};
export type Filings = {
  from: string;
  to: string;
  total: number;
  rows: Filing[];
};
export type DartBasis = "CFS" | "OFS";
export type DartReport = "11011" | "11013" | "11012" | "11014";
export const dartReportNames: Record<DartReport, string> = {
  "11011": "사업보고서",
  "11013": "1분기보고서",
  "11012": "반기보고서",
  "11014": "3분기보고서",
};
export type DartAccount = {
  id: string;
  name: string;
  section: "BS" | "IS" | "CIS" | "CF";
  current: number | null;
  previous: number | null;
  cumulative: number | null;
  currency: string;
  currentLabel: string;
  previousLabel: string;
};
export type DartStatement = {
  year: number;
  report: DartReport;
  basis: DartBasis;
  receipt: string | null;
  accounts: DartAccount[];
  cashflow: {
    operating: number | null;
    investing: number | null;
    financing: number | null;
  };
};
export function flowTotals(rows: InvestorDay[], days: number) {
  const window = rows.slice(0, days);
  const sum = (key: "foreign" | "institution" | "individual") =>
    window.length === days && window.every((row) => row[key] !== null)
      ? window.reduce((total, row) => total + row[key]!, 0)
      : null;
  return {
    count: window.length,
    foreign: sum("foreign"),
    institution: sum("institution"),
    individual: sum("individual"),
  };
}
export function commonFinancialDate(
  companies: { financials: Pick<StockFinancials, "rows"> }[],
) {
  const usable = (row: FinancialRow) =>
    row.revenue !== null && row.operatingProfit !== null;
  return (
    companies[0]?.financials.rows
      .filter(usable)
      .map((row) => row.date)
      .sort()
      .reverse()
      .find((date) =>
        companies.every((company) =>
          company.financials.rows.some(
            (row) => row.date === date && usable(row),
          ),
        ),
      ) ?? null
  );
}
