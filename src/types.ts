export type User = {
  id: number;
  username: string;
  name: string;
  role: "admin" | "member";
};
export type Stock = {
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
  exchangeTime?: string;
  session?: string;
  receivedAt: number;
  asks: { price: number; quantity: number }[];
  bids: { price: number; quantity: number }[];
};
export type Order = {
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
  fills?: { id: number; quantity: number; price: number; created_at: string }[];
  created_at: string;
  note: string;
};
export type Holding = {
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
  holdings: Holding[];
  orders: Order[];
};
export type Member = User & { cash: number; deposits: number };
export type Grant = {
  id: number;
  name: string;
  amount: number;
  note: string;
  created_at: string;
};
