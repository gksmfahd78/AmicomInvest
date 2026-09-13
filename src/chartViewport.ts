import type { Candle } from "./types";
export type ChartWindow = { from: string; to: string; anchor: string };
const dayMs = 86400000;
const time = (date: string) => Date.parse(date + "T00:00:00Z");
export const shiftChartDate = (date: string, days: number) =>
  new Date(time(date) + days * dayMs).toISOString().slice(0, 10);
export const periodName = (period: string) =>
  period === "W" ? "주봉" : period === "M" ? "월봉" : "일봉";
export function zoomPeriod(
  period: string,
  shown: number,
  total: number,
  factor: number,
  automatic: boolean,
) {
  if (!automatic || !shown) return period;
  const wanted = Math.round(shown * factor);
  if (factor < 1 && wanted < 20)
    return period === "M" ? "W" : period === "W" ? "D" : period;
  if (factor > 1 && (wanted > 160 || shown >= total))
    return period === "D" ? "W" : period === "W" ? "M" : period;
  return period;
}
export function zoomDateWindow(
  visible: Candle[],
  period: string,
  factor: number,
  anchorRatio = 0.5,
): ChartWindow {
  const first = time(visible[0].date),
    last = time(visible.at(-1)!.date);
  const stride =
    visible.length > 1
      ? (last - first) / (visible.length - 1)
      : (period === "M" ? 30 : period === "W" ? 7 : 1) * dayMs;
  const ratio = Math.max(0, Math.min(1, anchorRatio));
  const center = first + (last - first) * ratio;
  const span = Math.max(dayMs, (last - first + stride) * factor);
  const date = (value: number) => new Date(value).toISOString().slice(0, 10);
  return {
    from: date(center - span * ratio),
    to: date(center + span * (1 - ratio)),
    anchor: date(center),
  };
}
export function windowIndices(bars: Candle[], window: ChartWindow) {
  const first = bars.findIndex(
    (b) => b.date >= window.from && b.date <= window.to,
  );
  if (first < 0) return null;
  const after = bars.findIndex((b, i) => i >= first && b.date > window.to);
  const count = Math.min(
    bars.length,
    Math.max(10, (after < 0 ? bars.length : after) - first),
  );
  return { start: Math.min(first, bars.length - count), count };
}
