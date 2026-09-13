import { useMemo, useState } from "react";
import type { AnalysisView } from "./workspaceNavigation";
import type { MarketAnalysisReport } from "./marketAnalysisTypes";
import type { StockThemeCatalog } from "./types";
import {
  analysisUniverse,
  breadthPercent,
  defaultScreener,
  screenStocks,
  themeStrength,
} from "./analysisInsights";
const signed = (v: number) => (v > 0 ? "+" : "") + v.toFixed(2) + "%";
const tone = (v: number) => (v > 0 ? "up" : v < 0 ? "down" : "muted");
const money = (v: number | null) =>
  v === null
    ? "—"
    : (v / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "억";
const clock = (at: string) =>
  new Date(at).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export default function AnalysisInsights({
  report,
  themes,
  onSelect,
  availableSymbols,
  section,
  onShowStocks,
}: {
  section: AnalysisView["tab"];
  onShowStocks: () => void;
  report: MarketAnalysisReport;
  themes: StockThemeCatalog | null;
  onSelect: (symbol: string) => void;
  availableSymbols: Set<string>;
}) {
  const [filters, setFilters] = useState(defaultScreener);
  const [themeSort, setThemeSort] = useState<"turnover" | "median" | "count">(
    "turnover",
  );
  const [minMembers, setMinMembers] = useState("2");
  const [historyMarket, setHistoryMarket] = useState<"KOSPI" | "KOSDAQ">(
    "KOSPI",
  );
  const [pointIndex, setPointIndex] = useState<number | null>(null);
  const [limit, setLimit] = useState(10);
  const [themeLimit, setThemeLimit] = useState(5);
  const rows = useMemo(() => analysisUniverse(report), [report]);
  const classified = useMemo(
    () => themeStrength(rows, themes?.themes ?? []),
    [rows, themes],
  );
  const ranked = [...classified]
    .filter((t) => t.count >= Number(minMembers))
    .sort(
      (a, b) =>
        (b[themeSort] ?? -Infinity) - (a[themeSort] ?? -Infinity) ||
        b.count - a.count,
    );
  const selectedRows = useMemo(
    () => screenStocks(rows, themes?.themes ?? [], filters),
    [rows, themes, filters],
  );
  const indices = report.indices.filter(
    (index) => report.market === "ALL" || index.market === report.market,
  );
  const history = report.history ?? [];
  const activeMarket = report.market === "ALL" ? historyMarket : report.market;
  const points = history.map((point) => ({
    at: point.collectedAt,
    index: point.indices.find((i) => i.market === activeMarket),
  }));
  const values = points.flatMap((point) =>
    point.index ? [point.index.changeRate] : [],
  );
  const selectedPoint =
    points[Math.min(pointIndex ?? points.length - 1, points.length - 1)];
  const low = Math.min(0, ...values) - 0.1,
    high = Math.max(0, ...values) + 0.1;
  const x = (at: string) =>
    24 +
    ((Date.parse(at) - Date.parse(points[0].at)) /
      Math.max(1, Date.parse(points.at(-1)!.at) - Date.parse(points[0].at))) *
      552;
  const y = (value: number) => 144 - ((value - low) / (high - low)) * 120;
  const failed = Object.values(report.sections).filter(
    (section) => section.error,
  ).length;
  const patch = (value: Partial<typeof filters>) => {
    setFilters((old) => ({ ...old, ...value }));
    setLimit(10);
  };
  return (
    <>
      {section === "overview" && (
        <section
          className="panel analysis-brief"
          aria-label="시장 해석"
          id="analysis-overview"
        >
          <div className="insight-heading">
            <h2>지수와 종목 흐름 한눈에</h2>
            <span className="muted">{rows.length}종목 분석 표본</span>
          </div>
          <div className="brief-grid">
            {indices.map((index) => {
              const breadth = breadthPercent(
                index.rising,
                index.falling,
                index.unchanged,
              );
              const label =
                breadth === null
                  ? "종목 분포 조회 지연"
                  : index.changeRate > 0 && breadth < 50
                    ? "지수 상승 · 상승 종목은 절반 미만"
                    : index.changeRate < 0 && breadth > 50
                      ? "지수 하락 · 상승 종목은 절반 이상"
                      : breadth > 50
                        ? "상승 종목 우세"
                        : breadth < 50
                          ? "상승 종목 절반 미만"
                          : "상승 종목 절반";
              return (
                <article key={index.market}>
                  <strong>
                    {index.market} · {label}
                  </strong>
                  <small>
                    상승 종목 비율{" "}
                    {breadth === null ? "—" : breadth.toFixed(1) + "%"} · 보합
                    포함
                  </small>
                </article>
              );
            })}
          </div>
          {!indices.length && (
            <p className="muted">
              지수 조회가 지연되어 시장 요약을 계산할 수 없습니다.
            </p>
          )}
          {failed > 0 && (
            <p className="analysis-notice" role="status">
              {failed}개 순위 지표 조회 지연 · 테마와 조건 검색은 정상 수집된
              목록만 집계합니다.
            </p>
          )}
        </section>
      )}
      {section === "themes" && (
        <section className="panel insight-details" id="analysis-themes">
          <div className="insight-heading theme-list-heading">
            <h2>테마 비교</h2>
            <span>등락률 · 거래대금</span>
          </div>
          <div className="insight-body">
            <div className="insight-filters">
              <label>
                테마 정렬
                <select
                  value={themeSort}
                  onChange={(e) => {
                    setThemeSort(e.target.value as typeof themeSort);
                    setThemeLimit(5);
                  }}
                >
                  <option value="turnover">표본 거래대금순</option>
                  <option value="median">등락률 중앙값순</option>
                  <option value="count">포함 종목 수순</option>
                </select>
              </label>
              <label>
                최소 표본
                <select
                  value={minMembers}
                  onChange={(e) => {
                    setMinMembers(e.target.value);
                    setThemeLimit(5);
                  }}
                >
                  <option value="1">1종목 이상</option>
                  <option value="2">2종목 이상</option>
                  <option value="3">3종목 이상</option>
                </select>
              </label>
            </div>
            <details className="analysis-method">
              <summary>집계 기준 · {rows.length}종목 표본</summary>
              <p className="insight-note">
                여러 순위의 중복 종목을 제거한 표본입니다. 테마 전체 수익률·매수
                자금 유입을 뜻하지 않으며 테마끼리 종목이 겹칠 수 있습니다.
                분류는 현재 테마 기준입니다.
              </p>
            </details>
            {!themes ? (
              <p className="empty">
                테마 분류를 불러오는 중입니다. 종목 검색은 이용할 수 있습니다.
              </p>
            ) : !ranked.length ? (
              <p className="empty">조건을 만족하는 테마 표본이 없습니다.</p>
            ) : (
              <div className="theme-strength-grid" data-sort={themeSort}>
                {ranked.slice(0, themeLimit).map((theme) => (
                  <details key={theme.code} className="theme-strength-card">
                    <summary>
                      <span className="theme-name">{theme.name}</span>
                      <span className="theme-median">
                        <small>등락률 중앙값</small>
                        <b className={tone(theme.median)}>
                          {signed(theme.median)}
                        </b>
                      </span>
                      <span className="theme-turnover">
                        <small>표본 거래대금</small>
                        <b>{money(theme.turnover)}</b>
                      </span>
                    </summary>
                    <div className="theme-members">
                      <p>
                        표본 {theme.count} / 분류 {theme.totalMembers}종목
                      </p>
                      <div
                        className="theme-ratio"
                        role="img"
                        aria-label={`표본 ${theme.count}종목 중 상승 ${theme.rising}종목`}
                      >
                        <i
                          style={{
                            width: (theme.rising / theme.count) * 100 + "%",
                          }}
                        />
                      </div>
                      <p>
                        상승 종목 {theme.rising} / {theme.count} · 거래대금{" "}
                        {theme.turnoverCount}종목 제공
                      </p>
                      <p>
                        표본 상승률 1위{" "}
                        <button
                          className="table-link"
                          disabled={!availableSymbols.has(theme.leader.symbol)}
                          onClick={() => onSelect(theme.leader.symbol)}
                        >
                          {theme.leader.name}
                        </button>
                      </p>
                      <button
                        type="button"
                        className="theme-explore"
                        onClick={() => {
                          patch({ ...defaultScreener, theme: theme.code });
                          onShowStocks();
                        }}
                      >
                        테마 종목 모아보기
                      </button>
                    </div>
                  </details>
                ))}
              </div>
            )}
            {ranked.length > themeLimit && (
              <button
                className="theme-explore"
                onClick={() => setThemeLimit((v) => v + 5)}
              >
                5개 테마 더 보기 ({themeLimit} / {ranked.length})
              </button>
            )}
          </div>
        </section>
      )}
      {section === "stocks" && (
        <details className="panel insight-details" id="analysis-screener">
          <summary>
            조건으로 종목 찾기{" "}
            <span>{selectedRows.length}종목 · 조건 조합</span>
          </summary>
          <div className="insight-body">
            <div
              className="screener-presets"
              role="group"
              aria-label="종목 조건 프리셋"
            >
              <button
                onClick={() =>
                  patch({
                    ...defaultScreener,
                    minRate: "3",
                    minTurnover: "100",
                    minRatio: "2",
                  })
                }
              >
                상승 + 거래량 증가
              </button>
              <button
                onClick={() =>
                  patch({ ...defaultScreener, minTurnover: "1000" })
                }
              >
                거래대금 1,000억 이상
              </button>
              <button onClick={() => patch(defaultScreener)}>
                조건 초기화
              </button>
            </div>
            <div className="insight-filters screener-fields">
              <label>
                최소 등락률 (%)
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="제한 없음"
                  value={filters.minRate}
                  onChange={(e) => patch({ minRate: e.target.value })}
                />
              </label>
              <label>
                최소 거래대금 (억)
                <input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  placeholder="제한 없음"
                  value={filters.minTurnover}
                  onChange={(e) => patch({ minTurnover: e.target.value })}
                />
              </label>
              <label>
                전일 거래량 대비 (배)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  inputMode="decimal"
                  placeholder="제한 없음"
                  value={filters.minRatio}
                  onChange={(e) => patch({ minRatio: e.target.value })}
                />
              </label>
              <label>
                테마 조건
                <select
                  value={filters.theme}
                  onChange={(e) => patch({ theme: e.target.value })}
                >
                  <option value="">전체 테마</option>
                  {[...classified]
                    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
                    .map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                결과 정렬
                <select
                  value={filters.sort}
                  onChange={(e) =>
                    patch({ sort: e.target.value as typeof filters.sort })
                  }
                >
                  <option value="turnover">거래대금순</option>
                  <option value="changeRate">상승률순</option>
                  <option value="volumeRatio">거래량 증가순</option>
                </select>
              </label>
            </div>
            <p className="insight-note">
              조회된 {rows.length}종목 안에서 검색합니다. ‘상승 + 거래량 증가’는
              +3%·100억·전일 하루 거래량의 2배 이상입니다. 같은 시간대 비교가
              아니며 조건에 필요한 값이 없으면 제외합니다.
            </p>
            <div className="screener-results" aria-label="조건 검색 결과">
              {selectedRows.slice(0, limit).map((row) => (
                <article key={row.symbol}>
                  <div>
                    <button
                      className="table-link"
                      disabled={!availableSymbols.has(row.symbol)}
                      onClick={() => onSelect(row.symbol)}
                    >
                      {row.name}
                    </button>
                    <small>
                      {row.symbol} · {row.market}
                    </small>
                  </div>
                  <b className={tone(row.changeRate)}>
                    {signed(row.changeRate)}
                  </b>
                  <dl>
                    <div>
                      <dt>거래대금</dt>
                      <dd>{money(row.turnover)}</dd>
                    </div>
                    <div>
                      <dt>전일 거래량 대비</dt>
                      <dd>
                        {row.volumeRatio === null
                          ? "—"
                          : row.volumeRatio.toFixed(2) + "배"}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
            {!selectedRows.length && (
              <p className="empty">
                조건에 맞는 종목이 없습니다. 기준을 낮추거나 초기화해 주세요.
              </p>
            )}
            {selectedRows.length > limit && (
              <button
                className="theme-explore"
                onClick={() => setLimit((v) => v + 10)}
              >
                10종목 더 보기 ({limit} / {selectedRows.length})
              </button>
            )}
          </div>
        </details>
      )}
      {section === "overview" && (
        <details className="panel insight-details" id="analysis-history">
          <summary>
            장중 흐름 기록 <span>{history.length}회 저장 · 5분 단위</span>
          </summary>
          <div className="insight-body">
            <label className="history-market">
              기록 지수
              <select
                value={activeMarket}
                disabled={report.market !== "ALL"}
                onChange={(e) => {
                  setHistoryMarket(e.target.value as typeof historyMarket);
                  setPointIndex(null);
                }}
              >
                <option value="KOSPI">코스피</option>
                <option value="KOSDAQ">코스닥</option>
              </select>
            </label>
            {values.length < 2 ? (
              <p className="empty">
                추이를 그리려면 같은 날 두 번 이상의 지수 수집 기록이
                필요합니다. 수집 전 구간은 채우지 않습니다.
              </p>
            ) : (
              <>
                <svg
                  className="analysis-history-chart"
                  viewBox="0 0 600 180"
                  role="img"
                  aria-label={`${activeMarket} 수집 시점별 전일 대비 등락률`}
                >
                  <line
                    x1="24"
                    x2="576"
                    y1={y(0)}
                    y2={y(0)}
                    stroke="var(--line)"
                    strokeDasharray="4 4"
                  />
                  <text x="24" y={y(0) - 5}>
                    0%
                  </text>
                  {points.map((point, i) => {
                    const prev = points[i - 1];
                    return point.index && prev?.index ? (
                      <line
                        key={point.at}
                        x1={x(prev.at)}
                        y1={y(prev.index.changeRate)}
                        x2={x(point.at)}
                        y2={y(point.index.changeRate)}
                        stroke="var(--accent)"
                        strokeWidth="2"
                      />
                    ) : null;
                  })}
                  {points.map((point) =>
                    point.index ? (
                      <circle
                        key={point.at}
                        cx={x(point.at)}
                        cy={y(point.index.changeRate)}
                        r="3"
                        fill="var(--accent)"
                      >
                        <title>
                          {clock(point.at)} · {signed(point.index.changeRate)}
                        </title>
                      </circle>
                    ) : null,
                  )}
                  <text x="24" y="173">
                    {clock(points[0].at)}
                  </text>
                  <text x="576" y="173" textAnchor="end">
                    {clock(points.at(-1)!.at)} KST
                  </text>
                </svg>
                <label className="history-slider">
                  수집 시점 선택
                  <input
                    type="range"
                    min="0"
                    max={points.length - 1}
                    value={Math.min(
                      pointIndex ?? points.length - 1,
                      points.length - 1,
                    )}
                    onChange={(e) => setPointIndex(Number(e.target.value))}
                  />
                </label>
                <p aria-live="polite">
                  {selectedPoint && clock(selectedPoint.at)} ·{" "}
                  {selectedPoint?.index
                    ? `${selectedPoint.index.value.toLocaleString("ko-KR")} (${signed(selectedPoint.index.changeRate)})`
                    : "지수 조회 누락"}
                </p>
              </>
            )}
            <p className="insight-note">
              전일 종가 대비 지수 등락률입니다. 선은 수집 시점 사이를 연결하며
              실제 분봉이 아닙니다. 날짜를 바꾸면 해당 날짜의 저장 기록을 확인할
              수 있습니다.
            </p>
          </div>
        </details>
      )}
    </>
  );
}
