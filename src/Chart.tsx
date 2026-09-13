import { useState } from "react";
import type { Candle } from "./types";
import type { StockNewsArticle } from "./newsTypes";
import { newsDay, newsCandleContext } from "./newsAnalysis";
export default function Chart({
  bars,
  news = [],
  focusedArticle,
  onNewsDate,
  onClearFocus,
}: {
  bars: Candle[];
  news?: StockNewsArticle[];
  focusedArticle?: StockNewsArticle | null;
  onNewsDate?: (day: string) => void;
  onClearFocus?: () => void;
}) {
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
  const context = focusedArticle
    ? newsCandleContext(focusedArticle, bars)
    : null;
  const counts = new Map<string, number>();
  for (const article of news) {
    const day = newsDay(article.publishedAt);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const days = bars
    .filter((bar) => counts.has(bar.date))
    .map((bar) => bar.date)
    .reverse();
  const selected =
    context && context.index >= 0 ? context.index : bars.length - 1;
  const active = bars[Math.min(hover ?? selected, bars.length - 1)];
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
        {context && context.index >= 0 && (
          <rect
            className="news-candle-highlight"
            x={left + context.index * step}
            y={top}
            width={Math.max(2, step)}
            height={H - top - 22}
            fill="var(--accent)"
            opacity=".14"
          />
        )}
        {bars.map((b, i) => {
          const x = left + i * step + step / 2;
          const color = b.close >= b.open ? "var(--up)" : "var(--down)";
          return (
            <g key={b.date}>
              {counts.has(b.date) && (
                <circle cx={x} cy={13} r={3.5} fill="var(--accent)" />
              )}
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
      {context && focusedArticle && (
        <section
          className="news-candle-context"
          aria-label="선택 뉴스의 일봉"
          aria-live="polite"
        >
          <div className="news-context-heading">
            <strong>뉴스 발행일 · {context.day}</strong>
            <button type="button" onClick={onClearFocus}>
              선택 해제
            </button>
          </div>
          <a
            href={focusedArticle.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {focusedArticle.title}
          </a>
          <p>
            {focusedArticle.source} ·{" "}
            {new Date(focusedArticle.publishedAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}{" "}
            KST · {context.session} <span>(정규장 09:00~15:30 기준)</span>
          </p>
          {context.bar ? (
            <>
              <dl>
                <div>
                  <dt>시가</dt>
                  <dd>{context.bar.open.toLocaleString()}원</dd>
                </div>
                <div>
                  <dt>종가 / 최근가</dt>
                  <dd>{context.bar.close.toLocaleString()}원</dd>
                </div>
                <div>
                  <dt>전 거래일 대비</dt>
                  <dd>
                    {context.dayChange === null
                      ? "비교 데이터 없음"
                      : `${context.dayChange > 0 ? "+" : ""}${context.dayChange.toFixed(2)}%`}
                  </dd>
                </div>
              </dl>
              <p className="news-chart-note">
                발행일 전체의 일봉입니다. 기사 발표 순간의 가격이나 발표 이후
                수익률이 아닙니다.
                {context.session === "장 마감 후" &&
                  " 장 마감 후 기사이므로 당일 종가는 기사 발행 전 가격입니다."}
              </p>
            </>
          ) : (
            <p className="news-chart-note">
              이 날짜의 일봉이 없습니다. 휴장일이거나 현재 차트 범위 밖일 수
              있으며 다른 날짜의 가격으로 대체하지 않습니다.
            </p>
          )}
        </section>
      )}
      {days.length > 0 && (
        <div className="chart-news-dates">
          <p>
            <span aria-hidden="true">●</span> 뉴스가 있는 거래일 · 날짜를 누르면
            해당 기사를 봅니다
          </p>
          <div role="group" aria-label="차트 날짜별 뉴스">
            {days.map((day) => (
              <button
                type="button"
                key={day}
                onClick={() => onNewsDate?.(day)}
                aria-label={`${day} 뉴스 ${counts.get(day)}건`}
              >
                {day.slice(5)} <span>{counts.get(day)}건</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
