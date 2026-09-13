import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "../src/types";
import {
  calculateBollinger,
  bollingerPosition,
  calculateStochastic,
  calculateAtr,
  calculateObv,
  calculateCci,
  calculateMfi,
  calculateRsi,
  calculateMacd,
  ema,
} from "../src/chartIndicators";
const bar = (close: number, i = 0, rest: Partial<Candle> = {}): Candle => ({
  date: `2026-01-${String(i + 1).padStart(2, "0")}`,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  ...rest,
});
const near = (actual: number | null, expected: number) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) < 1e-8, `${actual} != ${expected}`);
};
test("볼린저 모집단 표준편차, 워밍업 및 밴드 밖 위치", () => {
  const bands = calculateBollinger(
    Array.from({ length: 20 }, (_, i) => bar(i + 1, i)),
  );
  assert.ok(bands.upper.slice(0, 19).every((v) => v === null));
  near(bands.middle[19], 10.5);
  near(bands.upper[19], 10.5 + 2 * Math.sqrt(33.25));
  near(bands.lower[19], 10.5 - 2 * Math.sqrt(33.25));
  assert.deepEqual(bollingerPosition(35, 30, 10, 20), {
    percentB: 125,
    bandwidth: 100,
  });
  assert.deepEqual(bollingerPosition(5, 30, 10, 20), {
    percentB: -25,
    bandwidth: 100,
  });
  assert.deepEqual(bollingerPosition(10, 10, 10, 10), {
    percentB: null,
    bandwidth: 0,
  });
});
test("스토캐스틱은 %K·%D 각각 3봉 평활화와 워밍업을 적용", () => {
  const { k, d } = calculateStochastic(
    [0, 3, 9, 6, 10, 0, 6].map((v, i) => bar(v, i, { high: 10, low: 0 })),
    3,
  );
  assert.deepEqual(k.slice(0, 4), [null, null, null, null]);
  near(k[4], 250 / 3);
  near(k[5], 160 / 3);
  near(d[6], 570 / 9);
  assert.ok(d.slice(0, 6).every((v) => v === null));
});
test("ATR은 가격 갭과 Wilder 평활화를 반영", () => {
  const values = calculateAtr(
    [
      bar(10, 0, { high: 11, low: 9 }),
      bar(13, 1, { high: 14, low: 12 }),
      bar(12, 2, { high: 13, low: 11 }),
      bar(18, 3, { high: 19, low: 17 }),
    ],
    3,
  );
  assert.deepEqual(values.slice(0, 2), [null, null]);
  near(values[2], 8 / 3);
  near(values[3], 37 / 9);
});
test("OBV는 보합일 거래량을 제외하고 상승·하락에 따라 누적", () => {
  assert.deepEqual(
    calculateObv([
      bar(10, 0, { volume: 100 }),
      bar(11, 1, { volume: 20 }),
      bar(11, 2, { volume: 30 }),
      bar(9, 3, { volume: 50 }),
    ]),
    [0, 20, 20, -30],
  );
});
test("CCI 평균 절대편차와 MFI 가격 방향·거래량 가중 계산", () => {
  near(
    calculateCci(
      [10, 20, 30].map((v, i) => bar(v, i)),
      3,
    )[2],
    100,
  );
  near(
    calculateMfi(
      [10, 20, 10, 20].map((v, i) => bar(v, i, { volume: i + 1 })),
      3,
    )[3],
    80,
  );
});
test("횡보·무거래·부족한 데이터에서 유한한 값 또는 계산 대기", () => {
  const flat = Array.from({ length: 60 }, (_, i) => bar(100, i, { volume: 0 }));
  near(calculateRsi(flat).at(-1)!, 50);
  near(calculateCci(flat).at(-1)!, 0);
  near(calculateMfi(flat).at(-1)!, 50);
  near(calculateStochastic(flat).d.at(-1)!, 50);
  near(calculateAtr(flat).at(-1)!, 0);
  near(calculateMacd(flat).histogram.at(-1)!, 0);
  for (const fn of [calculateRsi, calculateCci, calculateMfi, calculateAtr]) {
    assert.deepEqual(fn([]), []);
    assert.ok(fn(flat.slice(0, 5)).every((v) => v === null));
  }
});
test("EMA·RSI·MACD 추세 기준값과 미래 봉 추가 시 과거값 불변", () => {
  const up = Array.from({ length: 70 }, (_, i) => bar(i + 1, i));
  near(
    ema(
      up.map((b) => b.close),
      20,
    )[19],
    10.5,
  );
  near(calculateRsi(up)[14], 100);
  near(calculateMacd(up).line[25], 7);
  near(calculateMacd(up).signal[33], 7);
  near(calculateMacd(up).histogram[33], 0);
  for (const fn of [
    calculateRsi,
    calculateCci,
    calculateMfi,
    calculateAtr,
    calculateObv,
  ])
    assert.deepEqual(fn(up).slice(0, 40), fn(up.slice(0, 40)));
  assert.deepEqual(
    calculateBollinger(up).upper.slice(0, 40),
    calculateBollinger(up.slice(0, 40)).upper,
  );
  assert.deepEqual(
    calculateStochastic(up).d.slice(0, 40),
    calculateStochastic(up.slice(0, 40)).d,
  );
});
