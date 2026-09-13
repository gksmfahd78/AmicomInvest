import type {
  FinancialKind,
  FinancialPeriod,
  FinancialRow,
  StockFinancials,
  Valuation,
} from "../src/financialTypes";

type Raw = Record<string, unknown>;
type StatementKind = Exclude<FinancialKind, "valuation">;
type Request = (
  path: string,
  tr: string,
  params: Record<string, string>,
  section: "finance" | "quotations",
) => Promise<unknown>;
const endpoints: Record<StatementKind, [string, string]> = {
  income: ["income-statement", "FHKST66430200"],
  balance: ["balance-sheet", "FHKST66430100"],
  ratios: ["financial-ratio", "FHKST66430300"],
};
const fields = {
  revenue: "sale_account",
  costOfSales: "sale_cost",
  grossProfit: "sale_totl_prfi",
  operatingProfit: "bsop_prti",
  netIncome: "thtr_ntin",
  currentAssets: "cras",
  fixedAssets: "fxas",
  assets: "total_aset",
  currentLiabilities: "flow_lblt",
  fixedLiabilities: "fix_lblt",
  liabilities: "total_lblt",
  equity: "total_cptl",
  roe: "roe_val",
  eps: "eps",
  bps: "bps",
  debtRatio: "lblt_rate",
} as const;
export function financialNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value).trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text.replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}
function record(value: unknown): Raw {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : {};
}
export function parseFinancialRows(value: unknown): FinancialRow[] {
  if (!Array.isArray(value)) throw Error("재무 응답 형식 오류");
  const rows = new Map<string, FinancialRow>();
  for (const input of value) {
    const raw = record(input),
      date = String(raw.stac_yymm ?? "");
    if (!/^(19|20)\d{2}(0[1-9]|1[0-2])$/.test(date) || rows.has(date)) continue;
    const row = { date } as FinancialRow;
    for (const [key, field] of Object.entries(fields))
      row[key as keyof typeof fields] = financialNumber(raw[field]);
    rows.set(date, row);
  }
  if (value.length && !rows.size) throw Error("재무 결산 기간 누락");
  return [...rows.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);
}
export function mergeFinancialRows(groups: FinancialRow[][]) {
  const rows = new Map<string, FinancialRow>();
  for (const group of groups)
    for (const row of group) {
      const old = rows.get(row.date);
      if (!old) rows.set(row.date, { ...row });
      else
        for (const key of Object.keys(fields) as (keyof typeof fields)[])
          if (row[key] !== null) old[key] = row[key];
    }
  return [...rows.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);
}
export function parseValuation(input: unknown): Valuation {
  const raw = record(input);
  const month = financialNumber(raw.stac_month);
  const positive = (key: string) => {
    const n = financialNumber(raw[key]);
    return n !== null && n > 0 ? n : null;
  };
  return {
    fiscalMonth:
      month !== null && Number.isInteger(month) && month >= 1 && month <= 12
        ? month
        : null,
    price: positive("stck_prpr"),
    marketCap: positive("hts_avls"),
    per: positive("per"),
    pbr: positive("pbr"),
    eps: financialNumber(raw.eps),
    bps: financialNumber(raw.bps),
    foreignOwnership: financialNumber(raw.hts_frgn_ehrt),
    listedShares: positive("lstn_stcn"),
    high52: positive("w52_hgpr"),
    low52: positive("w52_lwpr"),
  };
}
type Cached = {
  value: unknown;
  receivedAt: number | null;
  retryAt: number;
  failed: boolean;
};
export class FinancialsService {
  private cache = new Map<string, Cached>();
  private pending = new Map<string, Promise<Cached>>();
  constructor(
    private request: Request,
    private source: "kis" | "demo",
    private now = Date.now,
  ) {}

  private async load(
    key: string,
    ttl: number,
    fetcher: () => Promise<unknown>,
  ): Promise<Cached> {
    const hit = this.cache.get(key);
    if (hit && this.now() < hit.retryAt) return hit;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = (async () => {
      let entry: Cached;
      try {
        entry = {
          value: await fetcher(),
          receivedAt: this.now(),
          retryAt: this.now() + ttl,
          failed: false,
        };
      } catch {
        entry = {
          value: hit?.value ?? null,
          receivedAt: hit?.receivedAt ?? null,
          retryAt: this.now() + 60000,
          failed: true,
        };
      }
      this.cache.delete(key);
      this.cache.set(key, entry);
      while (this.cache.size > 256)
        this.cache.delete(this.cache.keys().next().value!);
      return entry;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  async get(symbol: string, period: FinancialPeriod): Promise<StockFinancials> {
    const kinds: FinancialKind[] = ["income", "balance", "ratios", "valuation"];
    const results = await Promise.all(
      kinds.map((kind) =>
        this.load(
          symbol + ":" + kind + (kind === "valuation" ? "" : ":" + period),
          kind === "valuation" ? 60000 : 6 * 3600000,
          async () => {
            if (this.source === "demo")
              return demoSection(kind, period, this.now());
            if (kind === "valuation") {
              const data = record(
                await this.request(
                  "inquire-price",
                  "FHKST01010100",
                  { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: symbol },
                  "quotations",
                ),
              );
              if (!data.output || !Object.keys(record(data.output)).length)
                throw Error("투자지표 응답 누락");
              return parseValuation(data.output);
            }
            const [path, tr] = endpoints[kind];
            const data = record(
              await this.request(
                path,
                tr,
                {
                  FID_DIV_CLS_CODE: period === "annual" ? "0" : "1",
                  fid_cond_mrkt_div_code: "J",
                  fid_input_iscd: symbol,
                },
                "finance",
              ),
            );
            return parseFinancialRows(data.output);
          },
        ),
      ),
    );
    const valuation = results[3].value as Valuation | null;
    const merged = mergeFinancialRows(
      results.slice(0, 3).map((item) => (item.value as FinancialRow[]) ?? []),
    );
    // Annual KIS responses may include the latest interim report before fiscal year-end.
    const interimDates =
      period === "annual" && valuation?.fiscalMonth
        ? merged
            .filter(
              (row) => Number(row.date.slice(4)) !== valuation.fiscalMonth,
            )
            .map((row) => row.date)
        : [];
    return {
      symbol,
      period,
      source: this.source,
      amountUnit: "억원",
      accountingBasis: "provider-unspecified",
      rows: merged.filter((row) => !interimDates.includes(row.date)),
      interimDates,
      valuation,
      sections: results.map((item, i) => ({
        kind: kinds[i],
        receivedAt: item.receivedAt,
        status: item.failed
          ? item.value === null
            ? "error"
            : "stale"
          : Array.isArray(item.value)
            ? item.value.length
              ? "ok"
              : "empty"
            : Object.values(record(item.value)).some((n) => n !== null)
              ? "ok"
              : "empty",
      })),
    };
  }
}

function demoSection(
  kind: FinancialKind,
  period: FinancialPeriod,
  now: number,
) {
  if (kind === "valuation")
    return parseValuation({
      stck_prpr: 80000,
      stac_month: 12,
      hts_avls: 4800000,
      per: 12.8,
      pbr: 1.2,
      eps: 6250,
      bps: 66667,
      hts_frgn_ehrt: 45.5,
      lstn_stcn: 6000000000,
      w52_hgpr: 95000,
      w52_lwpr: 55000,
    });
  const year = new Date(now).getUTCFullYear() - 1;
  return parseFinancialRows(
    Array.from({ length: period === "annual" ? 5 : 8 }, (_, index) => {
      const y = year - Math.floor(index / (period === "annual" ? 1 : 4));
      const month = period === "annual" ? 12 : 12 - (index % 4) * 3;
      const factor = ((1 - (year - y) * 0.08) * month) / 12;
      return {
        stac_yymm: String(y) + String(month).padStart(2, "0"),
        ...(kind === "income"
          ? {
              sale_account: 2400000 * factor,
              sale_cost: 1600000 * factor,
              sale_totl_prfi: 800000 * factor,
              bsop_prti: 240000 * factor,
              thtr_ntin: 180000 * factor,
            }
          : kind === "balance"
            ? {
                cras: 1500000 * factor,
                fxas: 2100000 * factor,
                total_aset: 3600000 * factor,
                flow_lblt: 500000 * factor,
                fix_lblt: 300000 * factor,
                total_lblt: 800000 * factor,
                total_cptl: 2800000 * factor,
              }
            : {
                roe_val: 8.2,
                eps: 6250 * factor,
                bps: 66667 * factor,
                lblt_rate: 28.57,
              }),
      };
    }),
  );
}
