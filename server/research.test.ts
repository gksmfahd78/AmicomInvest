import test from "node:test";
import assert from "node:assert/strict";
import { derivePeriods, shiftQuarter } from "../src/financialPeriods";
import { commonFinancialDate, flowTotals } from "../src/researchTypes";
import { parseFinancialRows } from "./financials";
import {
  dateKey,
  parseDividends,
  parseEstimates,
  parseFlows,
  ResearchService,
} from "./research";
import { ResearchCache } from "./research-cache";
import {
  DartService,
  parseCorpCodes,
  parseDartStatement,
  parseFilings,
} from "./dart";
import { zipSync, strToU8 } from "fflate";

const cumulative = () =>
  parseFinancialRows([
    {
      stac_yymm: "202512",
      sale_account: 1000,
      bsop_prti: 100,
      thtr_ntin: 60,
      total_aset: 900,
      roe_val: 10,
    },
    { stac_yymm: "202509", sale_account: 700, bsop_prti: 70, thtr_ntin: 50 },
    { stac_yymm: "202506", sale_account: 400, bsop_prti: 50, thtr_ntin: 40 },
    { stac_yymm: "202503", sale_account: 150, bsop_prti: 20, thtr_ntin: 20 },
    { stac_yymm: "202412", sale_account: 900, bsop_prti: 90 },
    { stac_yymm: "202409", sale_account: 600, bsop_prti: 60 },
    { stac_yymm: "202406", sale_account: 300, bsop_prti: 30 },
    { stac_yymm: "202403", sale_account: 100, bsop_prti: 10 },
  ]);
test("단일 분기는 누적 차이, TTM은 연속 4분기 손익만 합산한다", () => {
  const single = derivePeriods(cumulative(), "single", 12);
  assert.deepEqual(
    single.slice(0, 4).map((row) => row.revenue),
    [300, 300, 250, 150],
  );
  assert.equal(single[0].assets, 900);
  assert.equal(single[0].roe, null);
  const ttm = derivePeriods(cumulative(), "ttm", 12);
  assert.equal(ttm[0].revenue, 1000);
  assert.equal(ttm[1].revenue, 1000);
  assert.equal(ttm[0].assets, 900);
  assert.equal(ttm.at(-1)?.revenue, null);
  assert.equal(shiftQuarter("202503", -1), "202412");
});
test("분기 누락·미확인 결산은 0이나 다른 연도의 분기로 메우지 않는다", () => {
  const incomplete = cumulative().filter((row) => row.date !== "202506");
  assert.equal(
    derivePeriods(incomplete, "single", 12).find((row) => row.date === "202509")
      ?.revenue,
    null,
  );
  assert.equal(derivePeriods(incomplete, "ttm", 12)[0].revenue, null);
  assert.deepEqual(derivePeriods(cumulative(), "ttm", null), []);
  assert.deepEqual(derivePeriods(cumulative(), "single", 3), []);
});
test("손실·실제 0·항목별 누락을 유지한다", () => {
  const rows = cumulative();
  rows[0].netIncome = 20;
  rows[0].costOfSales = 0;
  const result = derivePeriods(rows, "single", 12)[0];
  assert.equal(result.netIncome, -30);
  assert.equal(result.costOfSales, null);
});
test("기업 비교는 모든 회사의 동일 결산에 손익이 있는 기간만 선택한다", () => {
  const rows = cumulative();
  assert.equal(
    commonFinancialDate([
      { financials: { rows } },
      { financials: { rows: rows.slice(1) } },
    ]),
    "202509",
  );
  assert.equal(
    commonFinancialDate([
      { financials: { rows: rows.slice(0, 1) } },
      { financials: { rows: rows.slice(1) } },
    ]),
    null,
  );
});
test("수급의 미집계 일자·중복·0·음수를 구분한다", () => {
  const flows = parseFlows([
    { stck_bsop_date: "20260911", stck_clpr: "100", frgn_ntby_qty: "" },
    {
      stck_bsop_date: "20260910",
      stck_clpr: "99",
      frgn_ntby_qty: "-1,000",
      orgn_ntby_qty: "0",
      prsn_ntby_qty: "1000",
    },
    { stck_bsop_date: "20260910", frgn_ntby_qty: "9" },
  ]);
  assert.deepEqual(flows.pendingDates, ["20260911"]);
  assert.equal(flows.rows.length, 1);
  assert.deepEqual(flowTotals(flows.rows, 1), {
    count: 1,
    foreign: -1000,
    institution: 0,
    individual: 1000,
  });
  assert.equal(flowTotals(flows.rows, 5).foreign, null);
  assert.equal(dateKey("2026/02/30"), null);
  assert.equal(dateKey("2026/04/16"), "20260416");
});
test("과거 수급 누락일을 건너뛰어 5일 합계를 만들지 않는다", () => {
  const flows = parseFlows([
    { stck_bsop_date: "20260910", frgn_ntby_qty: "1", orgn_ntby_qty: "1" },
    { stck_bsop_date: "20260909", frgn_ntby_qty: "", orgn_ntby_qty: "" },
    { stck_bsop_date: "20260908", frgn_ntby_qty: "3", orgn_ntby_qty: "3" },
  ]);
  assert.equal(flows.rows.length, 3);
  assert.equal(flowTotals(flows.rows, 2).foreign, null);
});
test("추정 실적은 결산의 E 표시와 항목 순서를 보존한다", () => {
  const value = {
    output1: { estdate: "20260730" },
    output4: [{ dt: "2025.12" }, { dt: "2026.12E" }],
    output2: [
      { data1: "100", data2: "200" },
      {},
      { data1: "10", data2: "-20" },
      {},
      { data1: "5", data2: "" },
      {},
    ],
  };
  const parsed = parseEstimates(value);
  assert.equal(parsed.rows[0].estimated, false);
  assert.equal(parsed.rows[1].estimated, true);
  assert.equal(parsed.rows[1].operatingProfit, -20);
  assert.equal(parsed.rows[1].netIncome, null);
  assert.throws(() => parseEstimates({ ...value, output2: [{}] }));
});
test("배당은 종목을 확인하고 지급일 공란·0원을 보존한다", () => {
  const parsed = parseDividends(
    [
      {
        sht_cd: "005930",
        record_date: "20260630",
        divi_pay_dt: "2026/08/20",
        per_sto_divi_amt: "000361",
        divi_kind: "분기",
      },
      { sht_cd: "000660", record_date: "20260630", per_sto_divi_amt: "999" },
      { sht_cd: "005930", record_date: "20260930", per_sto_divi_amt: "0" },
    ],
    "005930",
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].amount, 0);
  assert.equal(parsed[0].payDate, null);
  assert.equal(parsed[1].payDate, "20260820");
});
test("분석 캐시는 동시 조회를 합치고 실패 시 이전 수신 시각을 보존한다", async () => {
  let now = 1000,
    calls = 0;
  const cache = new ResearchCache(() => now);
  const fetch = async () => {
    calls++;
    return { value: 12 };
  };
  const first = await Promise.all([
    cache.get("a", 100, "kis", fetch),
    cache.get("a", 100, "kis", fetch),
  ]);
  assert.equal(calls, 1);
  assert.equal(first[0].status, "ok");
  now = 1200;
  const stale = await cache.get("a", 100, "kis", async () => {
    throw Error("provider detail");
  });
  assert.equal(stale.status, "stale");
  assert.equal(stale.receivedAt, 1000);
  assert.deepEqual(stale.data, { value: 12 });
  assert.equal(JSON.stringify(stale).includes("provider detail"), false);
  assert.equal(
    (
      await cache.get("b", 100, "kis", async () => {
        throw Error();
      })
    ).status,
    "error",
  );
});
test("종목 분석은 KIS의 수급·배당·예상 실적 API를 올바른 인자로 요청한다", async () => {
  const calls: {
    path: string;
    params: Record<string, string>;
    section?: string;
  }[] = [];
  const service = new ResearchService(
    async (path, _tr, params, section) => {
      calls.push({ path, params, section });
      return path === "estimate-perform"
        ? { output1: {}, output2: [], output4: [] }
        : path === "dividend"
          ? { output1: [] }
          : { output: [] };
    },
    "kis",
    () => Date.UTC(2026, 8, 11),
  );
  await service.flows("005930");
  await service.dividends("005930");
  await service.estimates("005930");
  assert.equal(calls[0].path, "inquire-investor");
  assert.equal(calls[1].section, "ksdinfo");
  assert.equal(calls[1].params.SHT_CD, "005930");
  assert.equal(calls[2].params.SHT_CD, "005930");
});
test("DART 기업 코드의 앞자리 0과 종목 매핑을 보존한다", () => {
  const codes = parseCorpCodes(
    "<result><list><corp_code>00126380</corp_code><stock_code>005930</stock_code></list><list><corp_code>00100000</corp_code><stock_code> </stock_code></list></result>",
  );
  assert.equal(codes.get("005930"), "00126380");
  assert.equal(codes.size, 1);
});
const account = (extra: Record<string, unknown>) => ({
  bsns_year: "2025",
  reprt_code: "11012",
  rcept_no: "20250814000001",
  sj_div: "CF",
  account_id: "ifrs-full_CashFlowsFromUsedInOperatingActivities",
  account_nm: "영업활동현금흐름",
  thstrm_amount: "10,000,000,000",
  frmtrm_amount: "-5,000,000,000",
  currency: "KRW",
  ...extra,
});
test("DART는 연결/별도와 통화를 유지하고 현금흐름을 억 원으로 환산한다", () => {
  const statement = parseDartStatement([account({})], 2025, "11012", "CFS");
  assert.equal(statement.basis, "CFS");
  assert.equal(statement.cashflow.operating, 100);
  assert.equal(statement.accounts[0].previous, -5000000000);
  assert.equal(
    parseDartStatement([account({ currency: "USD" })], 2025, "11012", "OFS")
      .cashflow.operating,
    null,
  );
  assert.equal(
    parseDartStatement([account({}), account({})], 2025, "11012", "CFS")
      .cashflow.operating,
    null,
  );
});
test("DART 분기 손익의 3개월 금액과 누적액을 혼합하지 않는다", () => {
  const statement = parseDartStatement(
    [
      account({
        sj_div: "IS",
        thstrm_amount: "100",
        thstrm_add_amount: "250",
        frmtrm_amount: "900",
        frmtrm_q_amount: "80",
        frmtrm_add_amount: "200",
      }),
    ],
    2025,
    "11012",
    "CFS",
  );
  assert.equal(statement.accounts[0].current, 100);
  assert.equal(statement.accounts[0].cumulative, 250);
  assert.equal(statement.accounts[0].previous, 80);
  assert.throws(() =>
    parseDartStatement([account({ bsns_year: "2024" })], 2025, "11012", "CFS"),
  );
});
test("공시는 안전한 접수번호 링크를 만들고 정정 공시를 구분한다", () => {
  const result = parseFilings([
    {
      rcept_no: "20260911000001",
      rcept_dt: "20260911",
      report_nm: "[기재정정] 현금배당 결정",
    },
    {
      rcept_no: "javascript:alert(1)",
      rcept_dt: "20260911",
      report_nm: "test",
    },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].category, "정정공시");
  assert.equal(
    result[0].url,
    "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260911000001",
  );
});
test("DART 키 미설정 시 네트워크 요청 없이 연결 대기 상태를 반환한다", async () => {
  const service = new DartService(undefined, Date.now, async () => {
    throw Error("must not call");
  });
  assert.equal((await service.filings("005930")).status, "unconfigured");
  assert.equal(
    (await service.statement("005930", 2025, "11011", "CFS")).status,
    "unconfigured",
  );
});
test("DART 활성화 시 기업 코드 ZIP과 선택한 기준의 보고서를 요청한다", async () => {
  const requested: URL[] = [];
  const service = new DartService(
    "unit-test-placeholder",
    () => Date.UTC(2026, 8, 11),
    async (input) => {
      const url = new URL(String(input));
      requested.push(url);
      if (url.pathname.endsWith("corpCode.xml"))
        return new Response(
          Buffer.from(
            zipSync({
              "CORPCODE.xml": strToU8(
                "<result><list><corp_code>00126380</corp_code><stock_code>005930</stock_code></list></result>",
              ),
            }),
          ),
        );
      return Response.json({ status: "000", list: [account({})] });
    },
  );
  const result = await service.statement("005930", 2025, "11012", "OFS");
  assert.equal(result.status, "ok");
  assert.equal(requested[1].searchParams.get("fs_div"), "OFS");
  assert.equal(requested[1].searchParams.get("corp_code"), "00126380");
  assert.equal(JSON.stringify(result).includes("unit-test-placeholder"), false);
});
test("DART 인증·한도 오류를 자료 없음으로 바꾸거나 키를 노출하지 않는다", async () => {
  const service = new DartService(
    "unit-test-placeholder",
    Date.now,
    async () => {
      throw Error("https://provider/?crtfc_key=unit-test-placeholder");
    },
  );
  const result = await service.filings("005930");
  assert.equal(result.status, "error");
  assert.equal(JSON.stringify(result).includes("unit-test-placeholder"), false);
});
