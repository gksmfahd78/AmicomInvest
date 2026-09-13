import type { Candle } from "./types";
export type NullableSeries = (number | null)[];

export function ema(values: number[], period: number): NullableSeries {
  const result: NullableSeries = Array(values.length).fill(null);
  if (values.length < period) return result;
  let value = values.slice(0, period).reduce((sum, n) => sum + n, 0) / period;
  result[period - 1] = value;
  const weight = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    value = values[i] * weight + value * (1 - weight);
    result[i] = value;
  }
  return result;
}

export function calculateRsi(bars: Candle[], period = 14): NullableSeries {
  const result: NullableSeries = Array(bars.length).fill(null);
  if (bars.length <= period) return result;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = bars[i].close - bars[i - 1].close;
    gains += Math.max(0, change);
    losses += Math.max(0, -change);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  const score = () =>
    averageLoss === 0
      ? averageGain === 0
        ? 50
        : 100
      : 100 - 100 / (1 + averageGain / averageLoss);
  result[period] = score();
  for (let i = period + 1; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period;
    result[i] = score();
  }
  return result;
}

export function calculateMacd(bars: Candle[]) {
  const closes = bars.map((bar) => bar.close);
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const line: NullableSeries = closes.map((_, i) =>
    fast[i] === null || slow[i] === null ? null : fast[i]! - slow[i]!,
  );
  const start = line.findIndex((value) => value !== null);
  const compact = start < 0 ? [] : line.slice(start).map((value) => value ?? 0);
  const compactSignal = ema(compact, 9);
  const signal: NullableSeries = Array(bars.length).fill(null);
  compactSignal.forEach((value, i) => {
    signal[start + i] = value;
  });
  const histogram = line.map((value, i) =>
    value === null || signal[i] === null ? null : value - signal[i]!,
  );
  return { line, signal, histogram };
}

export function calculateBollinger(bars: Candle[], period = 20) {
  const middle: NullableSeries = Array(bars.length).fill(null);
  const upper: NullableSeries = Array(bars.length).fill(null);
  const lower: NullableSeries = Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i++) {
    const values = bars.slice(i + 1 - period, i + 1).map((bar) => bar.close);
    const average = values.reduce((sum, value) => sum + value, 0) / period;
    const deviation = Math.sqrt(
      values.reduce((sum, value) => sum + (value - average) ** 2, 0) / period,
    );
    middle[i] = average;
    upper[i] = average + deviation * 2;
    lower[i] = average - deviation * 2;
  }
  return { middle, upper, lower };
}

// SMA preserves the warm-up gap instead of treating missing data as zero.
export function sma(values: NullableSeries, period: number): NullableSeries {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const window = values.slice(i - period + 1, i + 1);
    if (window.some((v) => v === null)) return null;
    return window.reduce<number>((sum, v) => sum + v!, 0) / period;
  });
}

// Slow stochastic: SMA(3) of fast %K, then SMA(3) for %D.
// https://www.tradingview.com/support/solutions/43000502332-stochastic-stoch/
export function calculateStochastic(bars: Candle[], period = 14) {
  const fast = bars.map((bar, i) => {
    if (i < period - 1) return null;
    const window = bars.slice(i - period + 1, i + 1);
    const high = Math.max(...window.map((b) => b.high));
    const low = Math.min(...window.map((b) => b.low));
    return high === low ? 50 : (100 * (bar.close - low)) / (high - low);
  });
  const k = sma(fast, 3);
  return { k, d: sma(k, 3) };
}

// Wilder smoothing. First TR uses high-low (no prior close is available).
export function calculateAtr(bars: Candle[], period = 14): NullableSeries {
  const ranges = bars.map((b, i) =>
    Math.max(
      b.high - b.low,
      i ? Math.abs(b.high - bars[i - 1].close) : 0,
      i ? Math.abs(b.low - bars[i - 1].close) : 0,
    ),
  );
  const result: NullableSeries = Array(bars.length).fill(null);
  if (bars.length < period) return result;
  let value = ranges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = value;
  for (let i = period; i < bars.length; i++) {
    value = (value * (period - 1) + ranges[i]) / period;
    result[i] = value;
  }
  return result;
}

// OBV starts at zero at the first loaded candle; its absolute level is not comparable across windows.
export function calculateObv(bars: Candle[]): NullableSeries {
  let value = 0;
  return bars.map((bar, i) => {
    if (i) value += Math.sign(bar.close - bars[i - 1].close) * bar.volume;
    return value;
  });
}
const typical = (b: Candle) => (b.high + b.low + b.close) / 3;
export function calculateCci(bars: Candle[], period = 20): NullableSeries {
  const prices = bars.map(typical);
  return prices.map((price, i) => {
    if (i < period - 1) return null;
    const window = prices.slice(i - period + 1, i + 1);
    const average = window.reduce((a, b) => a + b, 0) / period;
    const deviation =
      window.reduce((sum, v) => sum + Math.abs(v - average), 0) / period;
    return deviation === 0 ? 0 : (price - average) / (0.015 * deviation);
  });
}
export function calculateMfi(bars: Candle[], period = 14): NullableSeries {
  const prices = bars.map(typical);
  return bars.map((_, i) => {
    if (i < period) return null;
    let positive = 0,
      negative = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const flow = prices[j] * bars[j].volume;
      if (prices[j] > prices[j - 1]) positive += flow;
      if (prices[j] < prices[j - 1]) negative += flow;
    }
    if (positive + negative === 0) return 50;
    return (100 * positive) / (positive + negative);
  });
}
export function bollingerPosition(
  close: number,
  upper: number,
  lower: number,
  middle: number,
) {
  return {
    percentB:
      upper === lower ? null : ((close - lower) / (upper - lower)) * 100,
    bandwidth: middle === 0 ? null : ((upper - lower) / middle) * 100,
  };
}
export const indicatorDefinitions = [
  {
    key: "bollinger",
    label: "볼린저밴드(20,2)",
    group: "가격·추세",
    help: "20봉 평균 ± 표준편차 2배. 음영은 상·하단 사이의 가격 범위입니다.",
  },
  {
    key: "ema",
    label: "EMA(20)",
    group: "가격·추세",
    help: "최근 종가에 더 큰 비중을 두는 20봉 지수이동평균입니다.",
  },
  {
    key: "rsi",
    label: "RSI(14)",
    group: "모멘텀",
    help: "상승·하락 강도. 70 이상은 과매수, 30 이하는 과매도 참고 구간입니다.",
  },
  {
    key: "macd",
    label: "MACD(12,26,9)",
    group: "모멘텀",
    help: "단기·장기 EMA 차이와 시그널선. 막대는 두 선의 차이입니다.",
  },
  {
    key: "stochastic",
    label: "스토캐스틱(14,3,3)",
    group: "모멘텀",
    help: "최근 고저 범위 내 종가 위치를 평활화한 %K와 %D. 80·20을 참고합니다.",
  },
  {
    key: "cci",
    label: "CCI(20)",
    group: "모멘텀",
    help: "평균 가격에서 벗어난 정도. +100·−100을 참고하며 범위 제한은 없습니다.",
  },
  {
    key: "mfi",
    label: "MFI(14)",
    group: "거래량",
    help: "가격과 거래량을 함께 반영한 강도. 80·20을 참고합니다. 실제 자금 유입액은 아닙니다.",
  },
  {
    key: "obv",
    label: "OBV",
    group: "거래량",
    help: "종가 상승 시 거래량을 더하고 하락 시 뺍니다. 불러온 첫 봉을 0으로 삼아 방향을 비교합니다.",
  },
  {
    key: "atr",
    label: "ATR(14)",
    group: "변동성",
    help: "가격 갭을 포함한 평균 변동폭(원). 값이 커질수록 변동폭이 크며 방향은 나타내지 않습니다.",
  },
] as const;
export type Indicator = (typeof indicatorDefinitions)[number]["key"];
