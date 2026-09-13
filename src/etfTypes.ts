export type EtfInfo = {
  symbol: string;
  source: "kis" | "demo";
  receivedAt: number;
  price: number | null;
  nav: number | null;
  premiumRate: number | null;
  multiplier: number | null;
  category: string | null;
  referenceIndex: string | null;
  componentCount: number | null;
};
