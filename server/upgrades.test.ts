import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store, competitionPerformance } from "./db";
import { DrawingsStore } from "./drawings";
import { parseTick } from "./realtime";
import { validatePrice, tickSize, dayExpiry } from "../src/tradingRules";
import type { Book } from "../src/types";
function setup() {
  const s = new Store(":memory:", { commissionBps: 0, sellTaxBps: 0 });
  const u = s.createUser("test", "테스트", "password123");
  s.grant(u.id, u.id, 1000000, "test", randomUUID());
  return { s, u };
}
const book = (qty = 5, bidQty = 10): Book => ({
  receivedAt: Date.now(),
  asks: [{ price: 10000, quantity: qty }],
  bids: [{ price: 9900, quantity: bidQty }],
});
const input = (q = 10, p = 10000) => ({
  symbol: "005930",
  side: "buy" as const,
  type: "limit" as const,
  quantity: q,
  limitPrice: p,
  note: "",
  requestId: randomUUID(),
});
test("다른 호가 변화로 소진 잔량이 재충전되지 않고 증가량만 사용", () => {
  const { s, u } = setup();
  const o = s.place(u.id, input(), book())!;
  s.match("005930", book(5, 99));
  assert.equal(
    s.db.prepare("SELECT filled_quantity FROM orders WHERE id=?").get(o.id!)!
      .filled_quantity,
    5,
  );
  s.match("005930", book(7, 98));
  assert.equal(
    s.db.prepare("SELECT filled_quantity FROM orders WHERE id=?").get(o.id!)!
      .filled_quantity,
    7,
  );
  s.match("005930", book(3));
  s.match("005930", book(7));
  assert.equal(
    s.db.prepare("SELECT filled_quantity FROM orders WHERE id=?").get(o.id!)!
      .filled_quantity,
    7,
  );
  s.db.close();
});
test("호가가 표시 범위에서 사라졌다 돌아와도 사용 수량 유지", () => {
  const { s, u } = setup();
  const o = s.place(u.id, input(), book())!;
  s.match("005930", { ...book(), asks: [{ price: 10100, quantity: 8 }] });
  s.match("005930", book());
  assert.equal(
    s.db.prepare("SELECT filled_quantity FROM orders WHERE id=?").get(o.id!)!
      .filled_quantity,
    5,
  );
  s.db.close();
});
test("장 마감 만료는 체결내역 유지, 예약 해제, 이후 추가체결 차단", () => {
  const { s, u } = setup();
  s.place(u.id, { ...input(), expiresAt: Date.now() + 1000 }, book());
  const cash = s.user(u.id).cash;
  s.expire(Date.now() + 2000);
  assert.equal(s.reservedCash(u.id), 0);
  s.match("005930", book(50));
  assert.equal(s.user(u.id).cash, cash);
  assert.equal(
    s.db.prepare("SELECT cancel_reason FROM orders").get()!.cancel_reason,
    "장 마감 만료",
  );
  s.db.close();
});
test("부분 체결 정정, 재시도 중복 방지, 원래 체결 보존", () => {
  const { s, u } = setup();
  const o = s.place(u.id, input(), book())!;
  const change = {
    quantity: 3,
    limitPrice: 9900,
    expectedFilled: 5,
    requestId: randomUUID(),
  };
  const n = s.amend(u.id, Number(o.id), change, book())!;
  assert.equal(n.replaces_id, o.id);
  assert.equal(n.quantity, 3);
  assert.equal(s.reservedCash(u.id), 29700);
  assert.equal(s.amend(u.id, Number(o.id), change, book())!.id, n.id);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM orders").get()!.n, 2);
  assert.equal(s.db.prepare("SELECT SUM(quantity) n FROM fills").get()!.n, 5);
  s.db.close();
});
test("정정 실패 시 기존 주문·잔액·예약 전부 롤백, 체결 경쟁 감지", () => {
  const { s, u } = setup();
  const o = s.place(u.id, input(), book())!;
  const change = {
    quantity: 5,
    limitPrice: 1000000,
    expectedFilled: 5,
    requestId: randomUUID(),
  };
  assert.throws(() => s.amend(u.id, Number(o.id), change, book()), /현금/);
  assert.equal(s.reservedCash(u.id), 50000);
  assert.equal(
    s.db.prepare("SELECT status FROM orders").get()!.status,
    "pending",
  );
  assert.throws(
    () => s.amend(u.id, Number(o.id), { ...change, expectedFilled: 0 }, book()),
    /추가 체결/,
  );
  const v = s.createUser("other", "다른 계정", "password123");
  assert.throws(() => s.amend(v.id, Number(o.id), change, book()), /주문/);
  s.db.close();
});
test("가격대 경계 호가 단위와 한국시간 만료", () => {
  for (const p of [
    1999, 2000, 4995, 5000, 19990, 20000, 49950, 50000, 199900, 200000, 499500,
    500000,
  ])
    assert.doesNotThrow(() => validatePrice(p));
  for (const p of [2001, 5001, 20001, 50001, 200001, 500001])
    assert.throws(() => validatePrice(p));
  assert.equal(tickSize(268000), 500);
  assert.equal(
    dayExpiry(Date.parse("2026-09-07T00:30:00Z")),
    Date.parse("2026-09-07T06:30:00Z"),
  );
});
test("서버 그림 저장 계정·종목·봉 분리 및 동시 수정 충돌 방지", () => {
  const { s, u } = setup(),
    d = new DrawingsStore(s),
    other = s.createUser("other", "다른 계정", "password123");
  const drawing = {
    id: "a",
    tool: "trend",
    color: "#ff0000",
    width: 2,
    points: [{ date: "2026-09-07", offset: 0, price: 10000 }],
  };
  assert.equal(d.save(u.id, "005930", "D", 0, [drawing]).revision, 1);
  assert.equal(d.save(u.id, "005930", "D", 0, [drawing]).revision, 1);
  assert.throws(() => d.save(u.id, "005930", "D", 0, []), /다른 화면/);
  assert.equal(d.get(other.id, "005930", "D").drawings.length, 0);
  assert.equal(d.get(u.id, "005930", "W").drawings.length, 0);
  assert.equal(d.save(u.id, "005930", "D", 1, []).revision, 2);
  assert.throws(() =>
    d.save(u.id, "005930", "D", 2, [{ ...drawing, points: [] }]),
  );
  s.db.close();
});
test("KIS 실시간 호가 다중 레코드 파싱과 손상 데이터 차단", () => {
  const row = Array(59).fill("0");
  row[0] = "005930";
  row[1] = "110000";
  for (let i = 0; i < 10; i++) {
    row[3 + i] = String(10000 + i * 10);
    row[13 + i] = String(9990 - i * 10);
    row[23 + i] = "5";
    row[33 + i] = "8";
  }
  const ticks = parseTick("0|H0STASP0|002|" + [...row, ...row].join("^"), 123);
  assert.equal(ticks.length, 2);
  assert.equal(ticks[0].book!.asks.length, 10);
  assert.equal(ticks[0].book!.bids[0].quantity, 8);
  assert.equal(parseTick("0|H0STASP0|002|" + row.join("^")).length, 0);
  row[23] = "NaN";
  assert.equal(parseTick("0|H0STASP0|001|" + row.join("^")).length, 0);
});

test("배당과 주식분할은 중복 없이 계좌와 주문에 반영", () => {
  const { s, u } = setup();
  s.place(
    u.id,
    { ...input(10), type: "market" },
    {
      receivedAt: Date.now(),
      asks: [{ price: 10000, quantity: 10 }],
      bids: [{ price: 9900, quantity: 10 }],
    },
  );
  const pending = s.place(
    u.id,
    {
      ...input(10, 11000),
      side: "sell",
    },
    {
      receivedAt: Date.now(),
      asks: [{ price: 10100, quantity: 10 }],
      bids: [{ price: 9900, quantity: 10 }],
    },
  )!;
  const dividendId = randomUUID();
  const dividend = {
    symbol: "005930",
    type: "dividend" as const,
    cashPerShare: 100,
    effectiveDate: "2026-09-07",
    note: "현금배당",
    requestId: dividendId,
  };
  s.applyCorporateAction(u.id, dividend);
  s.applyCorporateAction(u.id, dividend);
  assert.equal(s.user(u.id).cash, 901000);
  assert.equal(s.user(u.id).dividends, 1000);
  assert.equal(
    s.db.prepare("SELECT COUNT(*) n FROM corporate_actions").get()!.n,
    1,
  );

  s.applyCorporateAction(u.id, {
    symbol: "005930",
    type: "split",
    numerator: 2,
    denominator: 1,
    effectiveDate: "2026-09-08",
    note: "2대1 분할",
    requestId: randomUUID(),
  });
  const holding = s.db
    .prepare("SELECT quantity,cost FROM holdings WHERE user_id=? AND symbol=?")
    .get(u.id, "005930");
  assert.equal(holding!.quantity, 20);
  assert.equal(holding!.cost, 100000);
  assert.equal(
    s.db.prepare("SELECT status FROM orders WHERE id=?").get(pending.id!)!
      .status,
    "cancelled",
  );
  assert.throws(
    () =>
      s.applyCorporateAction(u.id, {
        symbol: "005930",
        type: "split",
        numerator: 1,
        denominator: 3,
        effectiveDate: "2026-09-09",
        note: "병합",
        requestId: randomUUID(),
      }),
    /단주/,
  );
  s.db.close();
});

test("투자 분석은 체결 손익과 계좌 낙폭을 집계", () => {
  const { s, u } = setup();
  s.place(
    u.id,
    { ...input(10), type: "market", note: "진입 이유" },
    {
      receivedAt: Date.now(),
      asks: [{ price: 10000, quantity: 10 }],
      bids: [{ price: 9900, quantity: 10 }],
    },
  );
  s.place(
    u.id,
    {
      ...input(10),
      side: "sell",
      type: "market",
      note: "청산 이유",
    },
    {
      receivedAt: Date.now(),
      asks: [{ price: 10600, quantity: 10 }],
      bids: [{ price: 10500, quantity: 10 }],
    },
  );
  s.recordEquity(u.id, 1000000, 0);
  s.recordEquity(u.id, 900000, 300000);
  const result = s.analytics(u.id);
  assert.equal(result.sellCount, 1);
  assert.equal(result.winRate, 100);
  assert.equal(result.averagePnl, 5000);
  assert.equal(result.noteRate, 100);
  assert.equal(result.maxDrawdown, -10);
  s.db.close();
});

test("모의투자 대회는 전원 기준자산을 저장하고 종료 성과를 고정", () => {
  const { s, u } = setup();
  const other = s.createUser("rival", "경쟁자", "password123");
  s.grant(other.id, u.id, 500000, "대회 투자금", randomUUID());
  const requestId = randomUUID();
  const input = {
    name: "9월 대회",
    startsAt: 1000,
    endsAt: 2000,
    benchmarkStart: 2500,
    requestId,
    entries: [
      { userId: u.id, assets: 1000000, deposits: 1000000 },
      { userId: other.id, assets: 500000, deposits: 500000 },
    ],
  };
  const competition = s.createCompetition(u.id, input)!;
  assert.equal(s.createCompetition(u.id, input)!.id, competition.id);
  assert.equal(s.competitionEntries(Number(competition.id)).length, 2);
  assert.throws(
    () =>
      s.createCompetition(u.id, {
        ...input,
        requestId: randomUUID(),
      }),
    /진행 중/,
  );
  assert.throws(
    () =>
      s.finishCompetition(Number(competition.id), 2600, [
        { userId: u.id, assets: 1100000, deposits: 1000000 },
      ]),
    /모든 참가자/,
  );
  s.finishCompetition(Number(competition.id), 2600, [
    { userId: u.id, assets: 1100000, deposits: 1000000 },
    { userId: other.id, assets: 550000, deposits: 500000 },
  ]);
  const ended = s.competitions()[0];
  assert.equal(ended.status, "ended");
  assert.equal(ended.benchmark_end, 2600);
  assert.equal(ended.participant_count, 2);

  const next = s.createCompetition(u.id, {
    ...input,
    startsAt: 3000,
    endsAt: 4000,
    requestId: randomUUID(),
  })!;
  const cancelled = s.cancelCompetition(u.id, Number(next.id), "일정 변경")!;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancel_reason, "일정 변경");
  assert.ok(Number(cancelled.cancelled_at) > 0);
  assert.equal(
    s.cancelCompetition(u.id, Number(next.id), "중복 요청")!.id,
    next.id,
  );
  assert.throws(
    () =>
      s.finishCompetition(Number(next.id), 2700, [
        { userId: u.id, assets: 1000000, deposits: 1000000 },
        { userId: other.id, assets: 500000, deposits: 500000 },
      ]),
    /진행 중/,
  );
  assert.equal(s.competitionEntries(Number(next.id)).length, 2);
  s.db.close();
});

test("대회 수익률은 추가 지급금을 제외하고 KOSPI 초과성과를 계산", () => {
  const result = competitionPerformance(1000000, 1000000, 1250000, 1100000, 3);
  assert.equal(result.netGrants, 100000);
  assert.equal(result.rate, 15);
  assert.equal(result.excessRate, 12);
  assert.deepEqual(competitionPerformance(0, 0, 0, 0, 3), {
    netGrants: 0,
    rate: null,
    excessRate: null,
  });
});
