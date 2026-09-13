import type { Instrument } from "./types";

export function tickSize(price: number, instrument: Instrument = "stock") {
  if (instrument === "etf") return price < 2000 ? 1 : 5;
  return price < 2000
    ? 1
    : price < 5000
      ? 5
      : price < 20000
        ? 10
        : price < 50000
          ? 50
          : price < 200000
            ? 100
            : price < 500000
              ? 500
              : 1000;
}
export function validatePrice(price: number, instrument: Instrument = "stock") {
  if (!Number.isSafeInteger(price) || price <= 0 || price > 100000000)
    throw Error("주문 가격 범위를 확인해주세요.");
  const tick = tickSize(price, instrument);
  if (price % tick !== 0)
    throw Error(
      "이 가격대는 " + tick.toLocaleString() + "원 단위로 주문할 수 있습니다.",
    );
}
export function koreaDate(now = Date.now()) {
  return new Date(now + 9 * 3600000).toISOString().slice(0, 10);
}
export function dayExpiry(now = Date.now()) {
  return Date.parse(koreaDate(now) + "T15:30:00+09:00");
}
