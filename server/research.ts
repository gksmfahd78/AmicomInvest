import { financialNumber } from "./financials";
import { ResearchCache } from "./research-cache";
import type {
  CompanyProfile,
  Dividends,
  Estimates,
  InvestorFlows,
} from "../src/researchTypes";

export type ResearchRequest = (
  path: string,
  tr: string,
  params: Record<string, string>,
  section?: "quotations" | "ksdinfo",
) => Promise<unknown>;
export function raw(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw Error("응답 배열 누락");
  return value.map(raw);
}
export function dateKey(value: unknown): string | null {
  const date = String(value ?? "").replace(/[./-]/g, "");
  if (!/^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(date))
    return null;
  const parsed = new Date(
    Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6)),
  );
  return parsed.toISOString().slice(0, 10).replaceAll("-", "") === date
    ? date
    : null;
}
export const koreaDate = (now: number) =>
  new Date(now + 9 * 3600000).toISOString().slice(0, 10).replaceAll("-", "");
export function parseFlows(value: unknown): InvestorFlows {
  const unique = new Map<string, InvestorFlows["rows"][number]>();
  const input = rows(value);
  for (const item of input) {
    const date = dateKey(item.stck_bsop_date);
    if (!date || unique.has(date)) continue;
    unique.set(date, {
      date,
      close: financialNumber(item.stck_clpr),
      foreign: financialNumber(item.frgn_ntby_qty),
      institution: financialNumber(item.orgn_ntby_qty),
      individual: financialNumber(item.prsn_ntby_qty),
    });
  }
  if (input.length && !unique.size) throw Error("수급 일자 누락");
  const sorted = [...unique.values()].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const first = sorted.findIndex((row) =>
    [row.foreign, row.institution, row.individual].some((n) => n !== null),
  );
  const offset = first < 0 ? sorted.length : first;
  return {
    rows: sorted.slice(offset, offset + 30),
    pendingDates: sorted.slice(0, offset).map((row) => row.date),
  };
}
export function parseEstimates(value: unknown): Estimates {
  const data = raw(value),
    periods = rows(data.output4),
    income = rows(data.output2);
  if (periods.length > 5 || (periods.length && income.length !== 6))
    throw Error("추정실적 구조 불일치");
  const seen = new Set<string>();
  const result: Estimates = {
    asOf: dateKey(raw(data.output1).estdate),
    rows: [],
  };
  periods.forEach((period, i) => {
    const match = /^(\d{4})\.(0[1-9]|1[0-2])(E)?$/.exec(
      String(period.dt ?? "").trim(),
    );
    if (!match) return;
    const date = match[1] + match[2];
    if (seen.has(date)) return;
    seen.add(date);
    result.rows.push({
      date,
      estimated: !!match[3],
      revenue: financialNumber(income[0]?.[`data${i + 1}`]),
      operatingProfit: financialNumber(income[2]?.[`data${i + 1}`]),
      netIncome: financialNumber(income[4]?.[`data${i + 1}`]),
    });
  });
  if (periods.length && !result.rows.length) throw Error("추정 결산일 누락");
  result.rows.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}
export function parseDividends(
  value: unknown,
  symbol: string,
): Dividends["rows"] {
  const result = new Map<string, Dividends["rows"][number]>();
  for (const item of rows(value)) {
    if (String(item.sht_cd ?? "").replace(/^A/, "") !== symbol) continue;
    const recordDate = dateKey(item.record_date);
    if (!recordDate) continue;
    const kind = String(item.divi_kind ?? "배당").slice(0, 30);
    result.set(recordDate + ":" + kind, {
      recordDate,
      kind,
      payDate: dateKey(item.divi_pay_dt),
      stockPayDate: dateKey(item.stk_div_pay_dt),
      amount: financialNumber(item.per_sto_divi_amt),
      stockRate: financialNumber(item.stk_divi_rate),
    });
  }
  return [...result.values()].sort((a, b) =>
    b.recordDate.localeCompare(a.recordDate),
  );
}
export function parseProfile(value: unknown): CompanyProfile {
  const data = raw(value);
  if (!Object.keys(data).length) throw Error("기업 개요 누락");
  const text = (key: string) =>
    String(data[key] ?? "")
      .trim()
      .slice(0, 120) || null;
  return {
    industry: text("std_idst_clsf_cd_name"),
    industryCode: text("std_idst_clsf_cd"),
    listedDate:
      dateKey(data.scts_mket_lstg_dt) ?? dateKey(data.kosdaq_mket_lstg_dt),
  };
}

export class ResearchService {
  private cache: ResearchCache;
  constructor(
    private request: ResearchRequest,
    private source: "kis" | "demo",
    private now = Date.now,
  ) {
    this.cache = new ResearchCache(now);
  }
  flows(symbol: string) {
    return this.cache.get(
      "flows:" + symbol,
      5 * 60000,
      this.source,
      async () => {
        if (this.source === "demo") {
          const result: InvestorFlows = { rows: [], pendingDates: [] };
          for (let day = 1; result.rows.length < 30; day++) {
            const time = this.now() - day * 86400000,
              weekday = new Date(time + 9 * 3600000).getUTCDay();
            if (weekday === 0 || weekday === 6) continue;
            result.rows.push({
              date: koreaDate(time),
              close: 80000 - day * 100,
              foreign: day % 3 === 0 ? -day * 1200 : day * 1000,
              institution: day % 2 === 0 ? day * 800 : -day * 1500,
              individual: day * 400,
            });
          }
          return result;
        }
        const data = raw(
          await this.request("inquire-investor", "FHKST01010900", {
            FID_COND_MRKT_DIV_CODE: "J",
            FID_INPUT_ISCD: symbol,
          }),
        );
        return parseFlows(data.output);
      },
      (value) => !value.rows.length,
    );
  }
  estimates(symbol: string) {
    return this.cache.get(
      "estimates:" + symbol,
      6 * 3600000,
      this.source,
      async () => {
        if (this.source === "demo") {
          const year = new Date(this.now()).getUTCFullYear();
          return {
            asOf: koreaDate(this.now()),
            rows: [-2, -1, 0, 1, 2].map((offset, i) => ({
              date: String(year + offset) + "12",
              estimated: offset >= 0,
              revenue: 2100000 + i * 180000,
              operatingProfit: 180000 + i * 50000,
              netIncome: 140000 + i * 30000,
            })),
          };
        }
        return parseEstimates(
          await this.request("estimate-perform", "HHKST668300C0", {
            SHT_CD: symbol,
          }),
        );
      },
      (value) => !value.rows.length,
    );
  }
  dividends(symbol: string) {
    return this.cache.get(
      "dividends:" + symbol,
      6 * 3600000,
      this.source,
      async (): Promise<Dividends> => {
        const from = koreaDate(this.now() - 365 * 86400000),
          to = koreaDate(this.now() + 90 * 86400000);
        if (this.source === "demo")
          return {
            from,
            to,
            rows: [
              {
                recordDate: koreaDate(this.now() - 80 * 86400000),
                payDate: koreaDate(this.now() - 30 * 86400000),
                stockPayDate: null,
                amount: 361,
                stockRate: 0,
                kind: "분기",
              },
            ],
          };
        const data = raw(
          await this.request(
            "dividend",
            "HHKDB669102C0",
            {
              CTS: "",
              GB1: "0",
              F_DT: from,
              T_DT: to,
              SHT_CD: symbol,
              HIGH_GB: "",
            },
            "ksdinfo",
          ),
        );
        return { from, to, rows: parseDividends(data.output1, symbol) };
      },
      (value) => !value.rows.length,
    );
  }
  profile(symbol: string) {
    return this.cache.get(
      "profile:" + symbol,
      24 * 3600000,
      this.source,
      async () => {
        if (this.source === "demo")
          return {
            industry: "데모 전자 산업",
            industryCode: "demo",
            listedDate: "20000101",
          };
        const data = raw(
          await this.request("search-stock-info", "CTPF1002R", {
            PRDT_TYPE_CD: "300",
            PDNO: symbol,
          }),
        );
        return parseProfile(data.output);
      },
    );
  }
}
