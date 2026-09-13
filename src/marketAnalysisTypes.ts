export const analysisMetrics = {
  upper: "상한가 포착",
  lower: "하한가 포착",
  gainers: "상승률",
  losers: "하락률",
  volume: "거래량",
  turnover: "거래대금",
  surge: "거래량 증가",
} as const;
export type AnalysisMetric = keyof typeof analysisMetrics;
export type AnalysisMarket = "ALL" | "KOSPI" | "KOSDAQ";
export type AnalysisStock = {
  symbol: string;
  name: string;
  market: string;
  price: number;
  changeRate: number;
  volume: number | null;
  turnover: number | null;
  volumeRatio: number | null;
  upperPrice: number | null;
  lowerPrice: number | null;
};
export type LimitHit = AnalysisStock & {
  firstSeen: string;
  lastSeen: string;
  active: boolean | null;
};
export type AnalysisSection = {
  rows: AnalysisStock[];
  error: string | null;
  collectedAt: string;
};
export type AnalysisIndex = {
  market: "KOSPI" | "KOSDAQ";
  value: number;
  changeRate: number;
  rising: number | null;
  falling: number | null;
  unchanged: number | null;
  upper: number | null;
  lower: number | null;
};
export type AnalysisHistoryPoint = {
  collectedAt: string;
  indices: AnalysisIndex[];
  upperCount: number;
  lowerCount: number;
};
export type MarketAnalysisReport = {
  date: string;
  market: AnalysisMarket;
  source: "kis" | "demo";
  collectedAt: string;
  indices: AnalysisIndex[];
  indexError: boolean;
  sections: Record<AnalysisMetric, AnalysisSection>;
  upperHits: LimitHit[];
  lowerHits: LimitHit[];
  history?: AnalysisHistoryPoint[];
};
export type MarketAnalysisResponse = {
  report: MarketAnalysisReport;
  dates: string[];
  stale: boolean;
};
