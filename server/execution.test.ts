import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "./db";
import { TradingRules } from "./trading";
import { clockState, bookState, activeVi } from "../src/executionRules";
import { parseTick } from "./realtime";
import type { Book } from "../src/types";
const at = (clock: string) => Date.parse("2026-09-10T" + clock + "+09:00");
const input = (quantity = 10) => ({
  symbol: "005930",
  side: "buy" as const,
  type: "limit" as const,
  quantity,
  limitPrice: 10000,
  note: "체결 검증",
  requestId: randomUUID(),
});
const book = (volume?: number, quantity = 10): Book => ({
  receivedAt: Date.now(),
  asks: [{ price: 10000, quantity }],
  bids: [{ price: 9900, quantity: 10 }],
  volume,
  volumeDate: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
});
function setup() {
  const store = new Store(":memory:", { commissionBps: 0, sellTaxBps: 0 });
  const user = store.createUser("execution", "체결", "password123");
  store.grant(user.id, user.id, 1000000, "검증", randomUUID());
  return { store, user };
}
test("시가·종가 단일가와 마감 경계는 일반 거래로 체결하지 않는다", () => {
  assert.equal(clockState(at("08:59:59"))?.phase, "opening_auction");
  assert.equal(clockState(at("09:00:00")), null);
  assert.equal(clockState(at("15:19:59")), null);
  assert.equal(clockState(at("15:20:00"))?.phase, "closing_auction");
  assert.equal(clockState(at("15:30:00"))?.phase, "off_hours");
  assert.equal(
    clockState(Date.parse("2026-09-12T10:00:00+09:00"))?.phase,
    "holiday",
  );
  const b = { ...book(), receivedAt: at("10:00:00"), marketPhase: "20" };
  assert.equal(bookState(b, at("10:00:00")).canTrade, true);
  assert.equal(
    bookState({ ...b, session: "1" }, at("10:00:00")).canTrade,
    false,
  );
  assert.equal(
    bookState({ ...b, marketPhase: undefined }, at("10:00:00")).canTrade,
    false,
  );
  assert.equal(bookState(b, at("10:00:21")).canTrade, false);
});
test("VI는 당일 종목의 발동·해제 기록으로 판정하고 경과 시간으로 해제하지 않는다", () => {
  const row = {
    mksc_shrn_iscd: "005930",
    bsop_date: "20260910",
    cntg_vi_hour: "090100",
    vi_cncl_hour: "",
  };
  assert.equal(activeVi([row], "005930", "20260910"), true);
  assert.equal(
    activeVi([{ ...row, vi_cncl_hour: "090300" }], "005930", "20260910"),
    false,
  );
  assert.equal(activeVi([row], "000660", "20260910"), false);
  assert.equal(activeVi([row], "005930", "20260911"), false);
  assert.equal(activeVi([], "005930", "20260910"), false);
  assert.throws(() => activeVi({}, "005930", "20260910"));
  assert.throws(() =>
    activeVi([{ ...row, cntg_vi_hour: "garbage" }], "005930", "20260910"),
  );
  assert.throws(() =>
    activeVi([{ ...row, vi_cncl_hour: "080000" }], "005930", "20260910"),
  );
});
test("상태 조회 실패·거래 정지·VI는 주문을 보류하고 데모는 독립적으로 동작한다", async () => {
  const { store } = setup();
  let halted = "N",
    vi: unknown[] = [],
    fail = false;
  const fetch = async (path: string) => {
    if (fail) throw Error("provider offline");
    if (path === "chk-holiday")
      return { output: [{ bass_dt: "20260910", opnd_yn: "Y" }] };
    if (path === "inquire-price")
      return {
        output: { temp_stop_yn: halted, stck_llam: "7000", stck_mxpr: "13000" },
      };
    return { output: vi };
  };
  const current = { ...book(), marketPhase: "20", receivedAt: at("10:00:00") };
  const rules = () =>
    new TradingRules(store, {
      now: () => at("10:00:00"),
      provider: "kis",
      fetch,
    });
  try {
    assert.equal((await rules().inspect("005930", current)).canTrade, true);
    await assert.rejects(
      () => rules().check("005930", 14000, current),
      /하한가/,
    );
    halted = "Y";
    assert.equal((await rules().inspect("005930", current)).phase, "halted");
    halted = "N";
    vi = [
      {
        mksc_shrn_iscd: "005930",
        bsop_date: "20260910",
        cntg_vi_hour: "093000",
        vi_cncl_hour: "",
      },
    ];
    await assert.rejects(
      () => rules().check("005930", 10000, current),
      /VI 발동/,
    );
    vi = [];
    fail = true;
    assert.equal((await rules().inspect("005930", current)).phase, "unknown");
    const demo = new TradingRules(store, {
      now: () => at("18:00:00"),
      provider: "demo",
      fetch,
    });
    assert.equal((await demo.inspect("005930", current)).phase, "demo");
  } finally {
    store.db.close();
  }
});
test("API를 기다리는 동안 종가 단일가가 시작되면 체결을 보류한다", async () => {
  const { store } = setup();
  let now = at("15:19:59");
  try {
    const rules = new TradingRules(store, {
      now: () => now,
      provider: "kis",
      fetch: async (path) => {
        if (path === "chk-holiday")
          return { output: [{ bass_dt: "20260910", opnd_yn: "Y" }] };
        now = at("15:20:00");
        return path === "inquire-price"
          ? {
              output: {
                temp_stop_yn: "N",
                stck_llam: "7000",
                stck_mxpr: "13000",
              },
            }
          : { output: [] };
      },
    });
    await assert.rejects(
      () =>
        rules.check("005930", 10000, {
          ...book(),
          marketPhase: "20",
          receivedAt: at("15:19:59"),
        }),
      /종가 단일가/,
    );
  } finally {
    store.db.close();
  }
});
test("같은 누적 거래량은 재사용하지 않고 증가분만 모의 잔량을 복원한다", () => {
  const { store, user } = setup();
  try {
    const o = store.place(user.id, input(30), book(100))!;
    assert.equal(o.filled_quantity, 10);
    store.match("005930", book(100));
    assert.equal(
      store.db
        .prepare("SELECT filled_quantity FROM orders WHERE id=?")
        .get(o.id!)!.filled_quantity,
      10,
    );
    store.match("005930", book(105));
    assert.equal(
      store.db
        .prepare("SELECT filled_quantity FROM orders WHERE id=?")
        .get(o.id!)!.filled_quantity,
      15,
    );
    store.match("005930", book(105));
    store.match("005930", book(102));
    assert.equal(
      store.db
        .prepare("SELECT filled_quantity FROM orders WHERE id=?")
        .get(o.id!)!.filled_quantity,
      15,
    );
    store.match("005930", book(110));
    assert.equal(
      store.db
        .prepare("SELECT filled_quantity FROM orders WHERE id=?")
        .get(o.id!)!.filled_quantity,
      20,
    );
    store.match("005930", book(120));
    assert.equal(
      store.db.prepare("SELECT status FROM orders WHERE id=?").get(o.id!)!
        .status,
      "filled",
    );
    const fills = store.db
      .prepare("SELECT * FROM fills WHERE order_id=?")
      .all(o.id!);
    assert.deepEqual(
      fills.map((f) => f.quantity),
      [10, 5, 5, 10],
    );
    assert.equal(fills[0].reference_price, 10000);
    assert.equal(fills[1].available_quantity, 5);
    assert.match(String(fills[0].execution_note), /지정가 조건/);
    assert.ok(Number(fills[0].book_received_at) > 0);
  } finally {
    store.db.close();
  }
});
test("거래량이 누락되거나 전일 값이면 잔량을 복원하지 않는다", () => {
  const { store, user } = setup();
  try {
    const o = store.place(user.id, input(20), book(100))!;
    store.match("005930", book());
    store.match("005930", { ...book(1000), volumeDate: "2020-01-01" });
    store.match("005930", book(NaN));
    assert.equal(
      store.db
        .prepare("SELECT filled_quantity FROM orders WHERE id=?")
        .get(o.id!)!.filled_quantity,
      10,
    );
  } finally {
    store.db.close();
  }
});
test("매수·매도의 잔량 복원 총합은 같은 거래량 증가분을 넘지 않는다", () => {
  const { store, user } = setup();
  try {
    store.place(user.id, input(10), book(100));
    const sell = store.place(
      user.id,
      { ...input(10), side: "sell", limitPrice: 9900 },
      book(100),
    )!;
    assert.equal(sell.filled_quantity, 10);
    store.match("005930", book(105));
    const remaining = store.db
      .prepare("SELECT SUM(quantity) n FROM liquidity")
      .get()!;
    assert.equal(remaining.n, 5);
    store.match("005930", book(105));
    assert.equal(
      store.db.prepare("SELECT SUM(quantity) n FROM liquidity").get()!.n,
      5,
    );
  } finally {
    store.db.close();
  }
});
test("실패한 주문은 거래량 기준점과 잔량 복원도 함께 롤백한다", () => {
  const { store, user } = setup();
  try {
    store.place(user.id, input(10), book(100));
    assert.throws(() => store.place(user.id, input(1000), book(105)), /현금/);
    assert.equal(
      store.db.prepare("SELECT volume FROM liquidity_recovery").get()!.volume,
      100,
    );
    assert.equal(
      store.db.prepare("SELECT quantity FROM liquidity WHERE side='ask'").get()!
        .quantity,
      0,
    );
  } finally {
    store.db.close();
  }
});
test("시장가 부분 체결·지정가 대기·상태 보류 사유를 각각 보존한다", () => {
  const { store, user } = setup();
  try {
    const market = store.place(
      user.id,
      { ...input(20), type: "market" },
      book(),
    )!;
    assert.equal(market.status, "cancelled");
    assert.match(String(market.execution_reason), /미체결 수량은 취소/);
    const waiting = store.place(
      user.id,
      { ...input(1), limitPrice: 9000 },
      book(),
    )!;
    assert.match(String(waiting.execution_reason), /지정가 조건/);
    store.defer("005930", "VI 발동 중");
    assert.equal(
      store.db
        .prepare("SELECT execution_reason FROM orders WHERE id=?")
        .get(waiting.id!)!.execution_reason,
      "VI 발동 중",
    );
    assert.notEqual(
      store.db
        .prepare("SELECT execution_reason FROM orders WHERE id=?")
        .get(market.id!)!.execution_reason,
      "VI 발동 중",
    );
  } finally {
    store.db.close();
  }
});
test("실시간 호가의 누적 거래량과 시간 구분을 분리해 읽는다", () => {
  const fields = Array(59).fill("0");
  fields[0] = "005930";
  fields[1] = "101010";
  fields[2] = "0";
  fields[3] = "10000";
  fields[13] = "9900";
  fields[23] = "10";
  fields[33] = "10";
  fields[53] = "12345";
  const tick = parseTick("0|H0STASP0|1|" + fields.join("^"), at("10:10:10"))[0];
  assert.equal(tick.book?.volume, 12345);
  assert.equal(tick.book?.session, "0");
  assert.equal(tick.book?.volumeDate, "2026-09-10");
});

test("재시작 후 같은 거래량은 복원 예산으로 재사용하지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "amicom-execution-")),
    path = join(dir, "study.sqlite");
  let store = new Store(path, { commissionBps: 0, sellTaxBps: 0 });
  try {
    const user = store.createUser("restart", "재시작", "password123");
    store.grant(user.id, user.id, 1000000, "검증", randomUUID());
    const order = store.place(user.id, input(30), book(100))!;
    store.match("005930", book(105));
    store.db.close();
    store = new Store(path, { commissionBps: 0, sellTaxBps: 0 });
    store.match("005930", book(105));
    assert.equal(
      store.db
        .prepare("SELECT filled_quantity FROM orders WHERE id=?")
        .get(order.id!)!.filled_quantity,
      15,
    );
    store.match("005930", book(110));
    assert.equal(
      store.db
        .prepare("SELECT filled_quantity FROM orders WHERE id=?")
        .get(order.id!)!.filled_quantity,
      20,
    );
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
