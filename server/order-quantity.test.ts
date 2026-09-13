import { test } from "node:test";
import assert from "node:assert/strict";
import { availableSellQuantity, quantityAtRatio } from "../src/orderQuantity";

test("매도 비율은 예약 수량을 제외한 주식으로 계산한다", () => {
  const available = availableSellQuantity({ quantity: 100, reserved: 20 });
  assert.equal(available, 80);
  assert.deepEqual(
    ([25, 50, 100] as const).map((ratio) => quantityAtRatio(available, ratio)),
    [20, 40, 80],
  );
  assert.equal(availableSellQuantity({ quantity: 60, reserved: 20 }), 40);
});

test("1~3주 보유 시 비율을 눌러도 0주가 되지 않고 보유 수량을 넘지 않는다", () => {
  for (const available of [1, 2, 3]) {
    assert.equal(quantityAtRatio(available, 25), 1);
    assert.equal(quantityAtRatio(available, 50), 1);
    assert.equal(quantityAtRatio(available, 100), available);
  }
  assert.equal(quantityAtRatio(7, 50), 3);
});

test("미보유·전량 예약·일시적 예약 초과는 매도 가능 0주다", () => {
  for (const held of [
    undefined,
    { quantity: 4, reserved: 4 },
    { quantity: 3, reserved: 4 },
  ]) {
    assert.equal(availableSellQuantity(held), 0);
    assert.equal(quantityAtRatio(availableSellQuantity(held), 100), 0);
  }
  assert.equal(quantityAtRatio(NaN, 100), 0);
});

test("비율은 전체 가능 수량 기준으로 계산하되 1회 주문 한도를 넘지 않는다", () => {
  assert.equal(quantityAtRatio(2000000, 25), 500000);
  assert.equal(quantityAtRatio(2000000, 100), 1000000);
});
