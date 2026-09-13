import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FinancialsService,
  financialNumber,
  parseFinancialRows,
  mergeFinancialRows,
  parseValuation,
} from "./financials";
import { margin, yearComparison } from "../src/financialTypes";

test("재무 숫자의 빈값과 오류는 0으로 바꾸지 않고 실제 0과 적자는 보존한다", () => {
  for (const value of [
    undefined,
    null,
    "",
    " ",
    "-",
    "N/A",
    false,
    {},
    "1,2",
    "Infinity",
    NaN,
  ])
    assert.equal(financialNumber(value), null);
  assert.equal(financialNumber("0.00"), 0);
  assert.equal(financialNumber("-1,234.50"), -1234.5);
  const [row] = parseFinancialRows([
    {
      stac_yymm: "202512",
      sale_account: "2589355.00",
      bsop_prti: "-10",
      thtr_ntin: "0",
    },
  ]);
  assert.equal(row.revenue, 2589355); // KIS amounts are already in KRW 100 million units.
  assert.equal(row.operatingProfit, -10);
  assert.equal(row.netIncome, 0);
  assert.equal(row.assets, null);
});

test("재무자료는 결산 년월로 병합하고 다른 결산의 숫자를 가져오지 않는다", () => {
  const merged = mergeFinancialRows([
    parseFinancialRows([
      { stac_yymm: "202506", sale_account: "100" },
      { stac_yymm: "202406", sale_account: "80" },
    ]),
    parseFinancialRows([
      { stac_yymm: "202503", total_aset: "500" },
      { stac_yymm: "202506", total_aset: "600" },
    ]),
    parseFinancialRows([{ stac_yymm: "202412", roe_val: "9", eps: "1200" }]),
  ]);
  assert.deepEqual(
    merged.map((row) => row.date),
    ["202506", "202503", "202412", "202406"],
  );
  assert.equal(merged[0].assets, 600);
  assert.equal(merged[0].roe, null);
  assert.equal(merged[1].revenue, null);
  assert.equal(merged[2].eps, 1200);
});

test("잘못된 결산과 중복 행은 제외하며 빈 목록과 비정상 응답을 구분한다", () => {
  assert.deepEqual(parseFinancialRows([]), []);
  assert.throws(() => parseFinancialRows({}));
  assert.throws(() => parseFinancialRows([{ stac_yymm: "202513" }]));
  const rows = parseFinancialRows([
    { stac_yymm: "202412", thtr_ntin: "0" },
    { stac_yymm: "202412", thtr_ntin: "8" },
    { stac_yymm: "202513" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].netIncome, 0);
});

test("PER·PBR의 무의미한 배수는 숨기며 EPS 손실과 외국인 0은 유지한다", () => {
  const values = parseValuation({
    per: "0",
    pbr: "-1",
    eps: "-500",
    bps: "3000",
    hts_avls: "1234",
    hts_frgn_ehrt: "0",
  });
  assert.equal(values.per, null);
  assert.equal(values.pbr, null);
  assert.equal(values.eps, -500);
  assert.equal(values.foreignOwnership, 0);
  assert.equal(values.marketCap, 1234);
  assert.equal(values.bps, 3000);
});

test("흑자 전환·적자 전환·기준값 누락을 일반 증감률과 구분한다", () => {
  assert.equal(yearComparison(20, -10, true), "전년 동기 대비 흑자 전환");
  assert.equal(yearComparison(-20, 10, true), "전년 동기 대비 적자 전환");
  assert.equal(yearComparison(-20, -10, true), "전년 동기 대비 적자 지속");
  assert.equal(yearComparison(100, 80), "전년 동기 +25.0%");
  assert.match(yearComparison(100, null), /자료 없음/);
  assert.match(yearComparison(100, 0), /계산 불가/);
  assert.equal(margin(-10, 100), -10);
  assert.equal(margin(10, 0), null);
  assert.equal(margin(null, 100), null);
});

test("연간과 분기 조회 구분을 전송하고 동시 요청과 투자지표 캐시를 공유한다", async () => {
  let now = 1000;
  const calls: { path: string; code?: string; section: string }[] = [];
  const service = new FinancialsService(
    async (path, _tr, params, section) => {
      calls.push({ path, code: params.FID_DIV_CLS_CODE, section });
      return {
        output:
          path === "inquire-price"
            ? { per: "12", pbr: "1" }
            : [{ stac_yymm: "202512", sale_account: "100" }],
      };
    },
    "kis",
    () => now,
  );
  const [a, b] = await Promise.all([
    service.get("005930", "annual"),
    service.get("005930", "annual"),
  ]);
  assert.deepEqual(a, b);
  assert.equal(calls.length, 4);
  assert.ok(
    calls.filter((c) => c.section === "finance").every((c) => c.code === "0"),
  );
  await service.get("005930", "quarter");
  assert.equal(calls.length, 7);
  assert.ok(calls.slice(4).every((c) => c.code === "1"));
  now += 61000;
  await service.get("005930", "annual");
  assert.equal(calls.length, 8);
  assert.equal(calls[7].path, "inquire-price");
});

test("일부 API 실패는 다른 재무자료를 살리고 빈 자료와 실패를 구분한다", async () => {
  const service = new FinancialsService(async (path) => {
    if (path === "balance-sheet") throw Error("upstream failed");
    return {
      output:
        path === "inquire-price"
          ? { per: "8" }
          : path === "financial-ratio"
            ? []
            : [{ stac_yymm: "202512", sale_account: "100" }],
    };
  }, "kis");
  const data = await service.get("005930", "annual");
  assert.equal(data.rows[0].revenue, 100);
  assert.equal(data.rows[0].assets, null);
  assert.equal(
    data.sections.find((s) => s.kind === "balance")?.status,
    "error",
  );
  assert.equal(data.sections.find((s) => s.kind === "ratios")?.status, "empty");
});

test("오래된 재무 캐시 갱신 실패 시 이전 자료임을 표시하고 재시도 폭주를 막는다", async () => {
  let now = 1000,
    fail = false,
    count = 0;
  const service = new FinancialsService(
    async (path) => {
      count++;
      if (fail) throw Error("timeout");
      return {
        output:
          path === "inquire-price"
            ? { per: "8" }
            : [{ stac_yymm: "202512", sale_account: "100" }],
      };
    },
    "kis",
    () => now,
  );
  await service.get("005930", "annual");
  now += 6 * 3600000 + 1;
  fail = true;
  const stale = await service.get("005930", "annual");
  assert.ok(
    stale.sections.every((s) => s.status === "stale" && s.receivedAt === 1000),
  );
  assert.equal(stale.rows[0].revenue, 100);
  await service.get("005930", "annual");
  assert.equal(count, 8);
});

test("데모 재무자료는 가상 출처를 명시하고 KIS를 호출하지 않는다", async () => {
  const service = new FinancialsService(async () => {
    throw Error("must not call");
  }, "demo");
  const data = await service.get("005930", "quarter");
  assert.equal(data.source, "demo");
  assert.equal(data.period, "quarter");
  assert.equal(data.rows.length, 8);
  assert.equal(data.amountUnit, "억원");
  assert.ok(data.sections.every((s) => s.status === "ok"));
});

test("연간 응답의 최근 중간결산은 결산 월로 걸러 내고 분기 조회에는 보존한다", async () => {
  const service = new FinancialsService(
    async (path) => ({
      output:
        path === "inquire-price"
          ? { stac_month: "12", per: "8" }
          : [
              { stac_yymm: "202606", sale_account: "200" },
              { stac_yymm: "202512", sale_account: "300" },
              { stac_yymm: "202412", sale_account: "280" },
            ],
    }),
    "kis",
  );
  const annual = await service.get("005930", "annual");
  assert.deepEqual(
    annual.rows.map((row) => row.date),
    ["202512", "202412"],
  );
  assert.deepEqual(annual.interimDates, ["202606"]);
  assert.equal((await service.get("005930", "quarter")).rows[0].date, "202606");
  const march = new FinancialsService(
    async (path) => ({
      output:
        path === "inquire-price"
          ? { stac_month: "03" }
          : [
              { stac_yymm: "202509", sale_account: "100" },
              { stac_yymm: "202503", sale_account: "200" },
            ],
    }),
    "kis",
  );
  assert.equal((await march.get("001234", "annual")).rows[0].date, "202503");
});
