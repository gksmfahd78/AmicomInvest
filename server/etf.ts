import type { EtfInfo } from "../src/etfTypes";
import { kis, known, provider, quote } from "./market";

function number(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function positive(value: unknown): number | null {
  const n = number(value);
  return n !== null && n > 0 ? n : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
export function parseEtf(
  symbol: string,
  row: Record<string, unknown>,
  receivedAt = Date.now(),
  source: EtfInfo["source"] = "kis",
): EtfInfo {
  const price = positive(row.stck_prpr),
    nav = positive(row.nav);
  const count = positive(row.etf_cnfg_issu_cnt);
  const multiplier = number(row.etf_trc_ert_mltp);
  return {
    symbol,
    source,
    receivedAt,
    price,
    nav,
    // Both values come from one provider response; underlying valuation times may differ.
    premiumRate:
      price !== null && nav !== null ? (price / nav - 1) * 100 : null,
    multiplier: multiplier === 0 ? null : multiplier,
    category: text(row.etf_div_name),
    referenceIndex: text(row.etf_rprs_bstp_kor_isnm),
    componentCount: count !== null && Number.isInteger(count) ? count : null,
  };
}
const cache = new Map<string, EtfInfo>();
const loading = new Map<string, Promise<EtfInfo>>();
export async function etfInfo(symbol: string): Promise<EtfInfo> {
  if (known(symbol).instrument !== "etf")
    throw Error("ETF 종목을 선택해주세요.");
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.receivedAt < 30000) return cached;
  const pending = loading.get(symbol);
  if (pending) return pending;
  const task = (async () => {
    let value: EtfInfo;
    if (provider === "demo") {
      const q = await quote(symbol);
      value = parseEtf(
        symbol,
        {
          stck_prpr: q.price,
          nav: q.price / 1.001,
          etf_trc_ert_mltp: 1,
          etf_div_name: "학습용 가상 자료",
          etf_rprs_bstp_kor_isnm: "가상 지수",
        },
        q.receivedAt,
        "demo",
      );
    } else {
      const response = await kis(
        "inquire-price",
        "FHPST02400000",
        { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: symbol },
        "quotations",
        "etfetn",
      );
      if (
        !response.output ||
        typeof response.output !== "object" ||
        Array.isArray(response.output)
      )
        throw Error("ETF 정보를 확인할 수 없습니다.");
      value = parseEtf(symbol, response.output);
    }
    cache.set(symbol, value);
    return value;
  })().finally(() => loading.delete(symbol));
  loading.set(symbol, task);
  return task;
}
