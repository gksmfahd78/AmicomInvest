import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "./db";
import { DrawingsStore } from "./drawings";
import { parseTick } from "./realtime";
import { validatePrice, tickSize, dayExpiry } from "../src/tradingRules";
import type { Book } from "../src/types";
function setup() {
  const s = new Store(":memory:");
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
