export type TradePlan = {
  horizon: string;
  invalidation: string;
  source: string;
};
export const emptyPlan: TradePlan = {
  horizon: "",
  invalidation: "",
  source: "",
};
export type TradeReview = {
  reason: string;
  adherence: "unreviewed" | "followed" | "partial" | "broken";
  lesson: string;
};
export type JournalEntry = {
  id: number;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  filled_quantity: number;
  status: string;
  created_at: string;
  note: string;
  replaces_id: number | null;
  realizedPnl: number;
  plan: TradePlan;
  context: {
    capturedAt: number;
    bid: number | null;
    ask: number | null;
  } | null;
  review: TradeReview;
  revision: number;
};
export type PerformancePoint = {
  at: number;
  equity: number;
  profit: number;
  rate: number | null;
  kospi: number | null;
  kosdaq: number | null;
};
export type PerformanceReport = {
  source?: "demo" | "kis";
  startedAt: number | null;
  lastAt: number | null;
  count: number;
  profit: number | null;
  netGrants: number;
  rate: number | null;
  maxDrawdown: number | null;
  flowGap: boolean;
  collectionGap: boolean;
  kospi: number | null;
  kosdaq: number | null;
  points: PerformancePoint[];
  periods: {
    label: string;
    profit: number;
    netGrants: number;
    rate: number | null;
  }[];
};
