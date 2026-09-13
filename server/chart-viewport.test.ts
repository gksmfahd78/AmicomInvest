import { test } from "node:test";
import assert from "node:assert/strict";
import {
  zoomPeriod,
  zoomDateWindow,
  windowIndices,
  shiftChartDate,
} from "../src/chartViewport";
import type { Candle } from "../src/types";
const bars = (length: number, stride = 1): Candle[] =>
  Array.from({ length }, (_, i) => ({
    date: shiftChartDate("2024-01-01", i * stride),
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 10,
  }));
test("확대는 월→주→일, 축소는 일→주→월 경계에서만 전환", () => {
  assert.equal(zoomPeriod("W", 100, 200, 0.7, true), "W");
  assert.equal(zoomPeriod("W", 24, 200, 0.7, true), "D");
  assert.equal(zoomPeriod("M", 24, 200, 0.7, true), "W");
  assert.equal(zoomPeriod("D", 10, 200, 0.7, true), "D");
  assert.equal(zoomPeriod("D", 140, 200, 1.4, true), "W");
  assert.equal(zoomPeriod("W", 140, 200, 1.4, true), "M");
  assert.equal(zoomPeriod("M", 200, 200, 1.4, true), "M");
  assert.equal(zoomPeriod("D", 15, 15, 1.4, true), "W");
  assert.equal(zoomPeriod("W", 24, 200, 0.7, false), "W");
  assert.equal(zoomPeriod("D", 200, 200, 1.4, false), "D");
  assert.equal(zoomPeriod("W", 0, 0, 0.7, true), "W");
});
test("과거 주봉 확대 시 중심 날짜와 실제 달력 범위로 일봉 구간 구성", () => {
  const weekly = bars(24, 7),
    window = zoomDateWindow(weekly, "W", 0.7);
  assert.equal(window.anchor, "2024-03-21");
  assert.equal(window.from, "2024-01-22");
  assert.equal(window.to, "2024-05-19");
  const daily = bars(200),
    view = windowIndices(daily, window)!;
  assert.equal(daily[view.start].date, window.from);
  assert.equal(daily[view.start + view.count - 1].date, window.to);
  assert.ok(view.count > 24);
});
test("포인터 위치를 확대 기준 날짜로 사용하고 차트 가장자리에 고정", () => {
  const weekly = bars(24, 7);
  assert.deepEqual(zoomDateWindow(weekly, "W", 0.7, 0.25), {
    anchor: "2024-02-10",
    from: "2024-01-11",
    to: "2024-05-08",
  });
  const left = zoomDateWindow(weekly, "W", 0.7, -1);
  assert.equal(left.from, weekly[0].date);
  assert.equal(left.anchor, weekly[0].date);
  const right = zoomDateWindow(weekly, "W", 0.7, 2);
  assert.equal(right.to, weekly.at(-1)!.date);
  assert.equal(right.anchor, weekly.at(-1)!.date);
});
test("제공 시세 밖 날짜를 최신 구간으로 대체하지 않고 빈 구간 처리", () => {
  assert.equal(
    windowIndices(bars(10), {
      from: "2020-01-01",
      to: "2020-01-31",
      anchor: "2020-01-15",
    }),
    null,
  );
  assert.equal(
    windowIndices([], {
      from: "2024-01-01",
      to: "2024-02-01",
      anchor: "2024-01-15",
    }),
    null,
  );
  assert.deepEqual(
    windowIndices(bars(5), {
      from: "2024-01-03",
      to: "2024-01-05",
      anchor: "2024-01-04",
    }),
    { start: 0, count: 5 },
  );
});
test("연도·윤년 경계와 한 봉만 있는 확대 범위", () => {
  assert.equal(shiftChartDate("2024-02-28", 1), "2024-02-29");
  assert.equal(shiftChartDate("2024-12-31", 1), "2025-01-01");
  const window = zoomDateWindow(bars(1), "W", 0.7);
  assert.equal(window.anchor, "2024-01-01");
  assert.ok(window.from < window.anchor && window.to > window.anchor);
});
