export type User = {
  id: number;
  username: string;
  name: string;
  role: "admin" | "member";
};
export type Instrument = "stock" | "etf";
export type Stock = {
  instrument?: Instrument;
  symbol: string;
  name: string;
  market: string;
  sector: string;
  base: number;
};
export type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
export type Quote = {
  halted?: boolean;
  exchangeTime?: string;
  tradingDate?: string;
  symbol: string;
  price: number;
  change: number;
  changeRate: number;
  high: number;
  low: number;
  open: number;
  volume: number;
  receivedAt: number;
  source: "demo" | "kis";
};
export type Book = {
  marketPhase?: string;
  volume?: number;
  volumeDate?: string;
  exchangeTime?: string;
  session?: string;
  receivedAt: number;
  asks: { price: number; quantity: number }[];
  bids: { price: number; quantity: number }[];
};
export type Order = {
  instrument?: Instrument;
  execution_reason?: string | null;
  expires_at?: number | null;
  cancel_reason?: string | null;
  replaces_id?: number | null;
  id: number;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  quantity: number;
  limit_price: number | null;
  status: "pending" | "filled" | "cancelled";
  fill_price: number | null;
  filled_quantity: number;
  filled_value: number;
  commission_bps: number;
  sell_tax_bps: number;
  fee: number;
  tax: number;
  fills?: {
    id: number;
    book_received_at?: number | null;
    available_quantity?: number | null;
    reference_price?: number | null;
    execution_note?: string | null;
    quantity: number;
    price: number;
    fee: number;
    tax: number;
    realized_pnl: number;
    cost_basis: number;
    created_at: string;
  }[];
  created_at: string;
  note: string;
};
export type Holding = {
  instrument?: Instrument;
  symbol: string;
  quantity: number;
  cost: number;
  reserved: number;
  price: number | null;
  name: string;
};
export type Account = {
  cash: number;
  available: number;
  deposits: number;
  realized: number;
  dividends: number;
  holdings: Holding[];
  orders: Order[];
};
export type TradingCosts = {
  commissionBps: number;
  sellTaxBps: number;
};
export type Member = User & {
  cash: number;
  available: number;
  deposits: number;
  assets: number | null;
  profit: number | null;
};
export type AdminSummary = {
  assets: number | null;
  profit: number | null;
  available: number;
  deposits: number;
  reserved: number;
};
export type InvestmentAnalytics = {
  orderCount: number;
  sellCount: number;
  winRate: number | null;
  averagePnl: number | null;
  profitFactor: number | null;
  turnover: number;
  fees: number;
  taxes: number;
  noteRate: number | null;
  maxDrawdown: number | null;
  snapshotCount: number;
};
export type MarketStatus = {
  provider: string;
  rest: {
    requests: number;
    successes: number;
    failures: number;
    lastSuccessAt: number | null;
    lastFailureAt: number | null;
    lastLatencyMs: number | null;
    lastPath: string | null;
    lastError: string | null;
  };
  realtime: {
    status: string;
    connected: boolean;
    wantedSymbols: number;
    subscribedSymbols: number;
    lastMessageAt: number | null;
    retryAt: number | null;
  };
};
export type CorporateAction = {
  id: number;
  symbol: string;
  type: "dividend" | "split";
  numerator: number | null;
  denominator: number | null;
  cash_per_share: number | null;
  effective_date: string;
  note: string;
  created_at: string;
};
export type Grant = {
  id: number;
  name: string;
  amount: number;
  note: string;
  created_at: string;
};
export type Competition = {
  id: number;
  name: string;
  status: "active" | "ended" | "finalizing" | "cancelled";
  starts_at: number;
  ends_at: number;
  benchmark_name: string;
  benchmark_start: number;
  benchmark_end: number | null;
  benchmark_rate: number | null;
  participant_count: number;
  cancelled_at: number | null;
  cancel_reason: string | null;
  created_at: string;
};
export type CompetitionRanking = {
  id: number;
  name: string;
  startingAssets: number;
  assets: number | null;
  netGrants: number;
  rate: number | null;
  excessRate: number | null;
};

export type StockTheme = { code: string; name: string; symbols: string[] };
export type StockThemeCatalog = { updatedAt: string; themes: StockTheme[] };
