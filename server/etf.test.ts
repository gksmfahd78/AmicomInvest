import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMaster } from "./catalog";
import { parseEtf } from "./etf";
import { stocks, quote, book as marketBook } from "./market";
import { Store } from "./db";
import { TradingRules } from "./trading";
import { tickSize, validatePrice } from "../src/tradingRules";
import { matchesStockSearch } from "../src/stockFilters";
import { portfolioRisk } from "../src/portfolioRisk";
import type { Book, Order, Stock } from "../src/types";
const fund: Stock = {
  symbol: "069500",
  name: "KODEX 200",
  market: "KOSPI",
  sector: "ETF",
  instrument: "etf",
  base: 35000,
};
const book = (): Book => ({
  receivedAt: Date.now(),
  asks: [{ price: 30005, quantity: 100 }],
  bids: [{ price: 30000, quantity: 100 }],
});
const input = () => ({
  symbol: fund.symbol,
  side: "buy" as const,
  type: "limit" as const,
  quantity: 10,
  limitPrice: 25005,
  note: "ETF 검증",
  requestId: randomUUID(),
});

test("공식 마스터 EF만 ETF로 분류하며 ETN·수익증권은 추가하지 않는다", () => {
  for (const market of ["KOSPI", "KOSDAQ"] as const) {
    const tail = market === "KOSPI" ? 227 : 221;
    const row = (symbol: string, group: string) =>
      symbol.padEnd(9) + "KR1234567890" + "Test Fund" + group.padEnd(tail, "0");
    const result = parseMaster(
      new TextEncoder().encode(
        [
          row("069500", "EF"),
          row("005930", "ST"),
          row("500001", "EN"),
          row("900001", "BC"),
        ].join("\n"),
      ),
      market,
    );
    assert.equal(result.length, 2);
    assert.equal(result[0].instrument, "etf");
    assert.equal(result[1].instrument, "stock");
    assert.equal(result[0].name, "Test Fund");
    assert.equal(matchesStockSearch(result[0], [], "ETF"), true);
    assert.equal(matchesStockSearch(result[1], [], "ETF"), false);
  }
});
test("ETF 2000원 경계와 주식 호가 단위를 구분한다", () => {
  assert.equal(tickSize(1999, "etf"), 1);
  assert.equal(tickSize(2000, "etf"), 5);
  assert.doesNotThrow(() => validatePrice(993, "etf"));
  assert.doesNotThrow(() => validatePrice(25005, "etf"));
  assert.doesNotThrow(() => validatePrice(100005, "etf"));
  assert.throws(() => validatePrice(2001, "etf"), /5원/);
  assert.throws(() => validatePrice(25005, "stock"), /50원/);
  assert.throws(() => validatePrice(0, "etf"));
});
test("NAV 누락·0은 가격 차이 0%로 표시하지 않고 음수 배수는 보존한다", () => {
  const d = parseEtf(
    fund.symbol,
    {
      stck_prpr: "10100",
      nav: "10000",
      etf_trc_ert_mltp: "-1.00",
      etf_cnfg_issu_cnt: "3",
    },
    123,
  );
  assert.ok(Math.abs(d.premiumRate! - 1) < 1e-10);
  assert.equal(d.multiplier, -1);
  assert.equal(d.receivedAt, 123);
  assert.equal(d.componentCount, 3);
  for (const nav of [undefined, null, "", " ", "0", "-1", "NaN", false, {}])
    assert.equal(
      parseEtf(fund.symbol, { stck_prpr: "10100", nav }).premiumRate,
      null,
    );
  assert.equal(
    parseEtf(fund.symbol, { stck_prpr: "10000", nav: "10000" }).premiumRate,
    0,
  );
});
test("ETF 정정·재시작 후에도 상품 분류와 거래세 면제, 수수료를 유지한다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amicom-etf-"));
  let store = new Store(
    join(dir, "test.sqlite"),
    { commissionBps: 10, sellTaxBps: 15 },
    () => "etf",
  );
  try {
    const u = store.createUser("etf", "ETF", "password123");
    store.grant(u.id, u.id, 1000000, "검증", randomUUID());
    await new TradingRules(store, { provider: "demo" }).check(
      fund.symbol,
      25005,
      book(),
    );
    const pending = store.place(u.id, input(), book()) as unknown as Order;
    assert.equal(pending.status, "pending");
    store.db.close();
    // Simulate a missing/changed catalog after restart: persisted classification must win.
    store = new Store(
      join(dir, "test.sqlite"),
      { commissionBps: 10, sellTaxBps: 15 },
      () => "stock",
    );
    const amended = store.amend(
      u.id,
      pending.id,
      {
        quantity: 10,
        limitPrice: 30005,
        expectedFilled: 0,
        requestId: randomUUID(),
      },
      book(),
    ) as unknown as Order;
    assert.equal(amended.instrument, "etf");
    assert.equal(amended.status, "filled");
    assert.equal(amended.fee, 300);
    const sell = store.place(
      u.id,
      { ...input(), side: "sell", type: "market" },
      book(),
    ) as unknown as Order;
    assert.equal(sell.tax, 0);
    assert.equal(sell.sell_tax_bps, 0);
    assert.equal(sell.fee, 300);
    assert.equal(store.user(u.id).cash, 999350);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("일반 주식은 ETF 거래세 면제로 바뀌지 않는다", () => {
  const store = new Store(":memory:", { commissionBps: 0, sellTaxBps: 15 });
  try {
    const u = store.createUser("stock", "주식", "password123");
    store.grant(u.id, u.id, 1000000, "검증", randomUUID());
    store.place(u.id, { ...input(), symbol: "005930", type: "market" }, book());
    const sale = store.place(
      u.id,
      { ...input(), symbol: "005930", side: "sell", type: "market" },
      book(),
    ) as unknown as Order;
    assert.equal(sale.instrument, "stock");
    assert.equal(sale.tax, 450);
    assert.throws(
      () => store.place(u.id, { ...input(), symbol: "005930" }, book()),
      /50원/,
    );
  } finally {
    store.db.close();
  }
});
test("ETF 보유 비중을 일반 업종으로 잘못 해석하지 않는다", () => {
  const r = portfolioRisk(
    {
      cash: 50000,
      available: 50000,
      deposits: 100000,
      realized: 0,
      dividends: 0,
      orders: [],
      holdings: [
        {
          symbol: fund.symbol,
          instrument: "etf",
          name: fund.name,
          quantity: 5,
          price: 10000,
          cost: 50000,
          reserved: 0,
        },
      ],
    },
    [fund],
    [],
  );
  assert.equal(r.complete, true);
  if (r.complete) {
    assert.equal(r.industries[0].name, "ETF · 구성 미분해");
    assert.equal(r.industries[0].weight, 50);
  }
});

test("영문 혼합 ETF 코드도 데모 가격과 등락률을 유효하게 생성한다", async () => {
  const symbol = "99999Z";
  stocks.push({ ...fund, symbol });
  try {
    const q = await quote(symbol);
    assert.ok(Number.isFinite(q.changeRate));
    assert.ok(Number.isSafeInteger(q.price));
    const b = await marketBook(symbol);
    assert.equal(b.asks[0].price - b.bids[0].price, tickSize(q.price, "etf"));
  } finally {
    stocks.splice(
      stocks.findIndex((s) => s.symbol === symbol),
      1,
    );
  }
});
