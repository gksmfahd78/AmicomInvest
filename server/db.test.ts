import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "./db";
import type { Book } from "../src/types";
const book = (
  asks = [
    { price: 9800, quantity: 3 },
    { price: 9900, quantity: 5 },
    { price: 10000, quantity: 20 },
  ],
  bids = [{ price: 9700, quantity: 100 }],
): Book => ({ receivedAt: Date.now(), asks, bids });
const input = (extra: Record<string, unknown> = {}) => ({
  symbol: "005930",
  side: "buy" as const,
  type: "limit" as const,
  quantity: 10,
  limitPrice: 9900,
  note: "test",
  requestId: randomUUID(),
  ...extra,
});
function setup() {
  const s = new Store(":memory:");
  const a = s.createUser("admin", "관리자", "password123", "admin"),
    u = s.createUser("member", "멤버", "password123");
  s.grant(a.id, u.id, 1000000, "지급", randomUUID());
  return { s, a, u };
}
test("지정가 10주 중 8주만 체결하고 미체결 2주 예약", () => {
  const { s, u } = setup();
  const o = s.place(u.id, input(), book())!;
  assert.equal(o.filled_quantity, 8);
  assert.equal(o.status, "pending");
  assert.equal(s.user(u.id).cash, 921100);
  assert.equal(s.reservedCash(u.id), 19800);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM fills").get()!.n, 2);
  s.db.close();
});
test("시장가는 여러 가격을 소진하고 정확한 가중 평균 기록", () => {
  const { s, u } = setup();
  const o = s.place(u.id, input({ type: "market" }), book())!;
  assert.equal(o.filled_quantity, 10);
  assert.equal(o.filled_value, 98900);
  assert.equal(o.fill_price, 9890);
  assert.equal(o.status, "filled");
  assert.equal(s.reservedCash(u.id), 0);
  s.db.close();
});
test("시장가 잔량 부족 시 부분 체결 후 미체결만 취소", () => {
  const { s, u } = setup();
  const o = s.place(u.id, input({ type: "market", quantity: 40 }), book())!;
  assert.equal(o.filled_quantity, 28);
  assert.equal(o.status, "cancelled");
  assert.equal(s.reservedCash(u.id), 0);
  s.db.close();
});
test("같은 호가를 재조회하거나 주문해도 잔량 중복 사용 안 함", () => {
  const { s, u, a } = setup();
  s.grant(a.id, a.id, 1000000, "지급", randomUUID());
  s.place(u.id, input(), book());
  const o = s.place(a.id, input(), book())!;
  assert.equal(o.filled_quantity, 0);
  s.match("005930", book());
  assert.equal(s.db.prepare("SELECT SUM(quantity) n FROM fills").get()!.n, 8);
  s.db.close();
});
test("호가 변화 후 대기 주문을 가격 우선으로 체결", () => {
  const { s, u } = setup();
  const empty = book([{ price: 10500, quantity: 2 }]);
  const low = s.place(u.id, input({ limitPrice: 9900, quantity: 2 }), empty)!;
  const high = s.place(u.id, input({ limitPrice: 10000, quantity: 2 }), empty)!;
  s.match("005930", book([{ price: 9900, quantity: 2 }]));
  assert.equal(
    s.db.prepare("SELECT status FROM orders WHERE id=?").get(high.id!)!.status,
    "filled",
  );
  assert.equal(
    s.db.prepare("SELECT filled_quantity FROM orders WHERE id=?").get(low.id!)!
      .filled_quantity,
    0,
  );
  s.db.close();
});
test("부분 체결 취소는 잔여 예약금만 해제하고 기존 체결 유지", () => {
  const { s, u, a } = setup();
  const o = s.place(u.id, input(), book())!;
  assert.throws(() => s.cancel(a.id, Number(o.id)), /취소/);
  s.cancel(u.id, Number(o.id));
  assert.equal(s.reservedCash(u.id), 0);
  assert.equal(s.user(u.id).cash, 921100);
  assert.equal(
    s.db.prepare("SELECT quantity FROM holdings WHERE user_id=?").get(u.id)!
      .quantity,
    8,
  );
  s.db.close();
});
test("매도는 매수호가 사용, 부분 매도 원가·실현손익·예약수량 보존", () => {
  const { s, u } = setup();
  s.place(u.id, input({ type: "market" }), book());
  const o = s.place(
    u.id,
    input({ side: "sell", quantity: 10, limitPrice: 10500 }),
    book(
      [{ price: 11000, quantity: 2 }],
      [
        { price: 10600, quantity: 4 },
        { price: 10500, quantity: 3 },
        { price: 10400, quantity: 50 },
      ],
    ),
  )!;
  assert.equal(o.filled_quantity, 7);
  assert.equal(s.reservedShares(u.id, "005930"), 3);
  assert.equal(s.user(u.id).realized, 4670);
  assert.throws(
    () =>
      s.place(
        u.id,
        input({ side: "sell", type: "market", quantity: 1 }),
        book([{ price: 11000, quantity: 2 }], [{ price: 10400, quantity: 50 }]),
      ),
    /주식/,
  );
  s.cancel(u.id, Number(o.id));
  assert.equal(s.reservedShares(u.id, "005930"), 0);
  s.db.close();
});
test("오래된 호가·교차 호가·잔액 부족 거절 시 변경 없음", () => {
  const { s, u } = setup();
  assert.throws(
    () => s.place(u.id, input(), { ...book(), receivedAt: Date.now() - 30000 }),
    /오래/,
  );
  assert.throws(
    () => s.place(u.id, input(), book([{ price: 9500, quantity: 2 }])),
    /교차/,
  );
  assert.throws(() => s.place(u.id, input({ quantity: 1000 }), book()), /현금/);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM orders").get()!.n, 0);
  assert.equal(s.user(u.id).cash, 1000000);
  s.db.close();
});
test("주문 재시도는 추가 체결을 발생시키지 않음", () => {
  const { s, u } = setup();
  const i = input();
  s.place(u.id, i, book());
  s.place(u.id, i, book());
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM orders").get()!.n, 1);
  assert.equal(s.user(u.id).cash, 921100);
  s.db.close();
});
test("잘못된 수량과 빈 호가의 시장가 주문 차단", () => {
  const { s, u } = setup();
  assert.throws(() => s.place(u.id, input({ quantity: -1 }), book()));
  assert.throws(
    () => s.place(u.id, input({ type: "market" }), book([], [])),
    /잔량/,
  );
  assert.equal(s.user(u.id).cash, 1000000);
  s.db.close();
});
