import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { financialNumber } from "./financials";
import { ResearchCache } from "./research-cache";
import { dateKey, koreaDate, raw, rows } from "./research";
import type {
  DartAccount,
  DartBasis,
  DartReport,
  DartStatement,
  Filings,
  ResearchResult,
} from "../src/researchTypes";

const receipt = (value: unknown) =>
  /^\d{14}$/.test(String(value ?? "")) ? String(value) : null;
export function parseCorpCodes(xml: string) {
  const document = new XMLParser({
    parseTagValue: false,
    processEntities: false,
  }).parse(xml);
  const list = document?.result?.list;
  const result = new Map<string, string>();
  for (const item of Array.isArray(list) ? list : list ? [list] : []) {
    const stock = String(item.stock_code ?? "").trim(),
      corp = String(item.corp_code ?? "").trim();
    if (/^\d{6}$/.test(stock) && /^\d{8}$/.test(corp)) result.set(stock, corp);
  }
  if (!result.size) throw Error("DART 기업 코드 자료 없음");
  return result;
}
export function filingCategory(title: string) {
  if (/정정/.test(title)) return "정정공시";
  if (/배당/.test(title)) return "배당";
  if (/유상증자|무상증자|감자|전환사채|신주인수권/.test(title))
    return "자본 변동";
  if (/자기주식|주식소각/.test(title)) return "자사주";
  if (/실적|손익|사업보고서|반기보고서|분기보고서/.test(title))
    return "실적·보고서";
  return "기타 공시";
}
export function parseFilings(value: unknown): Filings["rows"] {
  const found = new Map<string, Filings["rows"][number]>();
  for (const item of rows(value)) {
    const id = receipt(item.rcept_no),
      date = dateKey(item.rcept_dt),
      title = String(item.report_nm ?? "").slice(0, 300);
    if (id && date && title)
      found.set(id, {
        id,
        date,
        title,
        category: filingCategory(title),
        url: "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=" + id,
      });
  }
  return [...found.values()].sort((a, b) => b.id.localeCompare(a.id));
}
export function parseDartStatement(
  value: unknown,
  year: number,
  report: DartReport,
  basis: DartBasis,
): DartStatement {
  const input = rows(value),
    accounts: DartAccount[] = [];
  const receipts = new Set<string>();
  for (const item of input) {
    if (
      String(item.bsns_year) !== String(year) ||
      String(item.reprt_code) !== report
    )
      continue;
    const section = String(item.sj_div);
    if (!["BS", "IS", "CIS", "CF"].includes(section)) continue;
    const id = String(item.account_id ?? ""),
      name = String(item.account_nm ?? "").slice(0, 180);
    if (!name) continue;
    const rcp = receipt(item.rcept_no);
    if (rcp) receipts.add(rcp);
    const interimIncome = report !== "11011" && ["IS", "CIS"].includes(section);
    accounts.push({
      id,
      name,
      section: section as DartAccount["section"],
      current: financialNumber(item.thstrm_amount),
      previous: financialNumber(
        interimIncome ? item.frmtrm_q_amount : item.frmtrm_amount,
      ),
      cumulative: interimIncome
        ? financialNumber(item.thstrm_add_amount)
        : null,
      currency: String(item.currency ?? "미확인").toUpperCase(),
      currentLabel: String(item.thstrm_nm ?? "당기"),
      previousLabel: String(
        interimIncome
          ? (item.frmtrm_q_nm ?? "전년 동기")
          : (item.frmtrm_nm ?? "전기"),
      ),
    });
  }
  if (input.length && !accounts.length)
    throw Error("요청한 DART 보고서 자료 불일치");
  const cash = (id: string, names: string[]) => {
    const standard = accounts.filter(
      (a) => a.section === "CF" && a.id.replace(/^ifrs-full_/, "ifrs_") === id,
    );
    const matches = standard.length
      ? standard
      : accounts.filter(
          (a) =>
            a.section === "CF" && names.includes(a.name.replace(/\s/g, "")),
        );
    return matches.length === 1 &&
      matches[0].currency === "KRW" &&
      matches[0].current !== null
      ? matches[0].current / 100000000
      : null;
  };
  return {
    year,
    report,
    basis,
    receipt: receipts.size === 1 ? [...receipts][0] : null,
    accounts,
    cashflow: {
      operating: cash("ifrs_CashFlowsFromUsedInOperatingActivities", [
        "영업활동현금흐름",
        "영업활동으로인한현금흐름",
      ]),
      investing: cash("ifrs_CashFlowsFromUsedInInvestingActivities", [
        "투자활동현금흐름",
        "투자활동으로인한현금흐름",
      ]),
      financing: cash("ifrs_CashFlowsFromUsedInFinancingActivities", [
        "재무활동현금흐름",
        "재무활동으로인한현금흐름",
      ]),
    },
  };
}

export class DartService {
  private cache: ResearchCache;
  constructor(
    private key: string | undefined,
    private now = Date.now,
    private fetcher: typeof fetch = fetch,
  ) {
    this.cache = new ResearchCache(now);
  }
  private missing<T>(): ResearchResult<T> {
    return {
      status: "unconfigured",
      data: null,
      receivedAt: null,
      source: "dart",
    };
  }
  private async request(path: string, params: Record<string, string>) {
    // Never include the authenticated URL or upstream exception in logs/responses.
    try {
      const url = new URL("https://opendart.fss.or.kr/api/" + path);
      url.search = new URLSearchParams({
        ...params,
        crtfc_key: this.key!,
      }).toString();
      const response = await this.fetcher(url, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw Error("DART 응답 오류");
      return response;
    } catch {
      throw Error("DART 조회 실패");
    }
  }
  private async json(path: string, params: Record<string, string>) {
    const data = raw(await (await this.request(path, params)).json());
    if (data.status === "013") return { ...data, list: [], total_count: 0 };
    if (data.status !== "000") throw Error("DART 조회 실패");
    return data;
  }
  private async corp(symbol: string) {
    const codes = await this.cache.get(
      "corp",
      24 * 3600000,
      "dart",
      async () => {
        const response = await this.request("corpCode.xml", {});
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 30000000) throw Error("기업 코드 응답 크기 초과");
        const files = unzipSync(bytes, {
          filter: (file) =>
            file.name.toUpperCase() === "CORPCODE.XML" &&
            file.originalSize < 100000000,
        });
        const xml = Object.values(files)[0];
        if (!xml) throw Error("기업 코드 파일 누락");
        return parseCorpCodes(strFromU8(xml));
      },
    );
    if (!codes.data) throw Error("기업 코드 조회 실패");
    return codes.data.get(symbol) ?? null;
  }
  async filings(symbol: string): Promise<ResearchResult<Filings>> {
    if (!this.key) return this.missing();
    return this.cache.get(
      "filings:" + symbol,
      10 * 60000,
      "dart",
      async () => {
        const from = koreaDate(this.now() - 90 * 86400000),
          to = koreaDate(this.now());
        const corp = await this.corp(symbol);
        if (!corp) return { from, to, total: 0, rows: [] };
        const data = await this.json("list.json", {
          corp_code: corp,
          bgn_de: from,
          end_de: to,
          sort: "date",
          sort_mth: "desc",
          page_no: "1",
          page_count: "100",
          last_reprt_at: "N",
        });
        return {
          from,
          to,
          total: financialNumber(data.total_count) ?? 0,
          rows: parseFilings(data.list),
        };
      },
      (value) => !value.rows.length,
    );
  }
  async statement(
    symbol: string,
    year: number,
    report: DartReport,
    basis: DartBasis,
  ): Promise<ResearchResult<DartStatement>> {
    if (!this.key) return this.missing();
    return this.cache.get(
      ["statement", symbol, year, report, basis].join(":"),
      6 * 3600000,
      "dart",
      async () => {
        const corp = await this.corp(symbol);
        if (!corp) return parseDartStatement([], year, report, basis);
        const data = await this.json("fnlttSinglAcntAll.json", {
          corp_code: corp,
          bsns_year: String(year),
          reprt_code: report,
          fs_div: basis,
        });
        return parseDartStatement(data.list, year, report, basis);
      },
      (value) => !value.accounts.length,
    );
  }
}
