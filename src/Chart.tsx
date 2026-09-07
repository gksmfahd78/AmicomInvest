import { useState } from "react";
import type { Candle } from "./types";
export default function Chart({ bars }: { bars: Candle[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!bars.length)
    return <div className="chart-empty">차트 데이터가 없습니다.</div>;
  const W = 820,
    H = 320,
    left = 12,
    right = 74,
    top = 24,
    bottom = 62;
  const hi = Math.max(...bars.map((b) => b.high)) * 1.006,
    lo = Math.min(...bars.map((b) => b.low)) * 0.994;
  const y = (p: number) => top + ((hi - p) / (hi - lo)) * (H - top - bottom);
  const step = (W - left - right) / bars.length;
  const maxVolume = Math.max(1, ...bars.map((b) => b.volume));
  const active = bars[Math.min(hover ?? bars.length - 1, bars.length - 1)];
  return (
    <div className="chart-wrap">
      <div className="ohlc">
        <span>{active.date}</span>
        <span>
          시 <b>{active.open.toLocaleString()}</b>
        </span>
        <span>
          고 <b className="up">{active.high.toLocaleString()}</b>
        </span>
        <span>
          저 <b className="down">{active.low.toLocaleString()}</b>
        </span>
        <span>
          종 <b>{active.close.toLocaleString()}</b>
        </span>
      </div>
      <svg
        role="img"
        aria-label="주가 캔들 및 거래량 차트"
        viewBox={"0 0 " + W + " " + H}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(
            Math.max(
              0,
              Math.min(
                bars.length - 1,
                Math.floor(
                  (((e.clientX - r.left) / r.width) * W - left) / step,
                ),
              ),
            ),
          );
        }}
      >
        {Array.from({ length: 5 }, (_, i) => {
          const price = hi - ((hi - lo) * i) / 4;
          return (
            <g key={i}>
              <line
                x1={left}
                x2={W - right}
                y1={y(price)}
                y2={y(price)}
                stroke="var(--chart-grid)"
                strokeDasharray="3 5"
              />
              <text
                x={W - right + 12}
                y={y(price) + 4}
                fill="var(--chart-label)"
                fontSize="11"
              >
                {Math.round(price).toLocaleString()}
              </text>
            </g>
          );
        })}
        {bars.map((b, i) => {
          const x = left + i * step + step / 2;
          const color = b.close >= b.open ? "var(--up)" : "var(--down)";
          return (
            <g key={b.date}>
              <line x1={x} x2={x} y1={y(b.high)} y2={y(b.low)} stroke={color} />
              <rect
                x={x - step * 0.3}
                y={Math.min(y(b.open), y(b.close))}
                width={Math.max(2, step * 0.6)}
                height={Math.max(1, Math.abs(y(b.open) - y(b.close)))}
                fill={color}
              />
              <rect
                x={x - step * 0.3}
                y={H - 23 - (b.volume / maxVolume) * 28}
                width={Math.max(2, step * 0.6)}
                height={(b.volume / maxVolume) * 28}
                fill={color}
                opacity=".28"
              />
              {i % 16 === 0 && (
                <text
                  x={x}
                  y={H - 4}
                  textAnchor="middle"
                  fill="var(--chart-label)"
                  fontSize="10"
                >
                  {b.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
        {hover !== null && (
          <line
            x1={left + hover * step + step / 2}
            x2={left + hover * step + step / 2}
            y1={top}
            y2={H - 22}
            stroke="var(--chart-crosshair)"
            strokeDasharray="4 4"
          />
        )}
      </svg>
    </div>
  );
}
