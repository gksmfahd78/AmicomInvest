import type { Dispatch, SetStateAction } from "react";
import type { AnalysisView } from "./workspaceNavigation";
import MarketNews from "./MarketNews";
import { WorkspaceTabs } from "./WorkspaceTabs";
import type { StockNewsArticle } from "./newsTypes";
import AnalysisInsights from "./AnalysisInsights";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw, Search } from "lucide-react";
import {
  analysisMetrics,
  type AnalysisMarket,
  type AnalysisMetric,
  type AnalysisStock,
  type LimitHit,
  type MarketAnalysisResponse,
} from "./marketAnalysisTypes";
import { indexStockThemes } from "./stockFilters";
import type { StockThemeCatalog } from "./types";
import "./market-analysis.css";

const number = (value: number | null) =>
  value === null ? "—" : value.toLocaleString("ko-KR");
const percent = (value: number) =>
  (value > 0 ? "+" : "") + value.toFixed(2) + "%";
const color = (value: number) =>
  value > 0 ? "up" : value < 0 ? "down" : "muted";
function compact(value: number | null, unit = "") {
  if (value === null) return "—";
  const [scale, label] =
    value >= 1e12
      ? [1e12, "조"]
      : value >= 1e8
        ? [1e8, "억"]
        : value >= 1e4
          ? [1e4, "만"]
          : [1, ""];
  return (
    (value / Number(scale)).toLocaleString("ko-KR", {
      maximumFractionDigits: 2,
    }) +
    label +
    unit
  );
}
const time = (value: string) =>
  new Date(value).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function MarketAnalysis({
  view,
  onViewChange,
  onSelect,
  onNewsSelect,
  themes,
  availableSymbols,
}: {
  view: AnalysisView;
  onViewChange: Dispatch<SetStateAction<AnalysisView>>;
  onSelect: (symbol: string) => void;
  onNewsSelect: (symbol: string, article: StockNewsArticle) => void;
  themes: StockThemeCatalog | null;
  availableSymbols: Set<string>;
}) {
  const { market, date, metric, search, page, tab } = view;
  const setTab = (tab: AnalysisView["tab"]) =>
    onViewChange((v) => ({ ...v, tab }));
  const showScreener = () => {
    setTab("stocks");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const element =
          document.querySelector<HTMLDetailsElement>("#analysis-screener");
        if (element) {
          element.open = true;
          element.scrollIntoView({ block: "start", behavior: "smooth" });
        }
      }),
    );
  };
  const setMarket = (market: AnalysisMarket) =>
    onViewChange((v) => ({ ...v, market, page: 0 }));
  const setDate = (date: string) =>
    onViewChange((v) => ({ ...v, date, page: 0 }));
  const setMetric = (metric: AnalysisMetric) =>
    onViewChange((v) => ({ ...v, metric, page: 0 }));
  const setSearch = (search: string) =>
    onViewChange((v) => ({ ...v, search, page: 0 }));
  const setPage = (page: number) => onViewChange((v) => ({ ...v, page }));
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [data, setData] = useState<MarketAnalysisResponse | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const themeIndex = useMemo(
    () => indexStockThemes(themes?.themes ?? []),
    [themes],
  );
  const dataKey = useRef("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const key = market + ":" + date;
    if (dataKey.current !== key) setData(null);
    dataKey.current = key;
    const params = new URLSearchParams({ market });
    if (date) params.set("date", date);
    fetch("/api/market-analysis?" + params, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw Error(result.error || "시장 분석을 불러오지 못했습니다.");
        return result as MarketAnalysisResponse;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setDates(result.dates);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [market, date, reload]);
  useEffect(() => {
    if (date) return;
    const timer = setInterval(() => setReload((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, [date]);
  useEffect(() => {
    setExpandedRows(new Set());
  }, [market, date, metric, search]);
  const report = data?.report;
  const isLimit = metric === "upper" || metric === "lower";
  const primary =
    metric === "volume"
      ? "volume"
      : metric === "turnover"
        ? "turnover"
        : metric === "surge"
          ? "ratio"
          : "rate";
  const primaryClass = (column: string) =>
    primary === column ? " analysis-primary" : "";
  const priceLabel = isLimit ? "최근 포착가" : "현재가";
  const rateLabel = isLimit ? "포착 등락률" : "등락률";
  const rows: (AnalysisStock | LimitHit)[] = report
    ? metric === "upper"
      ? report.upperHits
      : metric === "lower"
        ? report.lowerHits
        : report.sections[metric].rows
    : [];
  const filtered = rows.filter((row) =>
    [
      row.name,
      row.symbol,
      ...(themeIndex.get(row.symbol) ?? []).map((theme) => theme.name),
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 20)),
    currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * 20, currentPage * 20 + 20);
  return (
    <div className="market-analysis">
      <div className="panel analysis-controls">
        <label>
          시장
          <select
            aria-label="분석 시장"
            value={market}
            onChange={(event) => {
              setMarket(event.target.value as AnalysisMarket);
              setDate("");
              setDates([]);
            }}
          >
            <option value="ALL">전체 시장</option>
            <option value="KOSPI">코스피</option>
            <option value="KOSDAQ">코스닥</option>
          </select>
        </label>
        <label>
          조회 날짜
          <select
            aria-label="분석 날짜"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          >
            <option value="">최신</option>
            {dates.map((day) => (
              <option key={day} value={day}>
                {day} · 저장 기록
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="analysis-refresh"
          aria-label={loading ? "조회 중…" : "새로고침"}
          disabled={loading}
          onClick={() => setReload((value) => value + 1)}
        >
          <RefreshCw size={16} />
          <span>{loading ? "조회 중…" : "새로고침"}</span>
        </button>
        <p
          title={report ? time(report.collectedAt) + " 수집 (KST)" : undefined}
        >
          {report
            ? `${report.date} · ${new Date(report.collectedAt).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false })} 수집 (KST)`
            : "시장 지표를 조회합니다."}
          {report?.source === "demo" && " · 샘플"}
        </p>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            다시 시도
          </button>
        </div>
      )}
      {loading && !report && (
        <div className="panel analysis-loading" aria-live="polite">
          지수와 종목 순위를 불러오고 있습니다…
        </div>
      )}
      {data?.stale && (
        <div className="analysis-notice" role="status">
          최신 조회가 지연되어 마지막으로 저장한 기록을 표시합니다. 수집 시각을
          확인해주세요.
        </div>
      )}
      {report && (
        <>
          <div
            className="analysis-index-grid"
            data-view={tab}
            role="region"
            aria-label="시장 요약"
          >
            {report.indices
              .filter((index) => market === "ALL" || index.market === market)
              .map((index) => {
                const total =
                  (index.rising ?? 0) +
                  (index.falling ?? 0) +
                  (index.unchanged ?? 0);
                return (
                  <section className="panel index-card" key={index.market}>
                    <h2>{index.market}</h2>
                    <div className="index-value">
                      <strong>{number(index.value)}</strong>
                      <span className={color(index.changeRate)}>
                        {percent(index.changeRate)}
                      </span>
                    </div>
                    <div
                      className="market-breadth"
                      role="img"
                      aria-label={`상승 ${number(index.rising)} · 보합 ${number(index.unchanged)} · 하락 ${number(index.falling)}`}
                    >
                      <span
                        className="breadth-up"
                        style={{ flex: index.rising ?? 0 }}
                      />
                      <span
                        className="breadth-flat"
                        style={{ flex: total ? (index.unchanged ?? 0) : 1 }}
                      />
                      <span
                        className="breadth-down"
                        style={{ flex: index.falling ?? 0 }}
                      />
                    </div>
                    <div className="breadth-labels">
                      <span className="up">상승 {number(index.rising)}</span>
                      <span>보합 {number(index.unchanged)}</span>
                      <span className="down">하락 {number(index.falling)}</span>
                    </div>
                    <p>
                      시장 전체 · 상한 {number(index.upper)} / 하한{" "}
                      {number(index.lower)}
                    </p>
                  </section>
                );
              })}
          </div>
          {report.indexError && (
            <p className="analysis-notice">
              일부 지수를 불러오지 못했습니다. 종목별 순위는 아래에서 확인할 수
              있습니다.
            </p>
          )}
          <WorkspaceTabs
            id="analysis"
            label="시장분석 보기"
            value={tab}
            items={[
              { key: "overview", label: "요약" },
              { key: "stocks", label: "종목" },
              { key: "themes", label: "테마" },
              { key: "news", label: "뉴스" },
            ]}
            onChange={(value) => setTab(value as AnalysisView["tab"])}
          />
          <div
            className="analysis-tab-content"
            role="tabpanel"
            id={"analysis-panel-" + tab}
            aria-labelledby={"analysis-tab-" + tab}
          >
            {tab === "stocks" && (
              <section
                className="panel analysis-ranking"
                id="analysis-ranking"
                data-metric={metric}
              >
                <div
                  className="analysis-tabs"
                  role="group"
                  aria-label="분석 지표"
                >
                  {(
                    Object.entries(analysisMetrics) as [
                      AnalysisMetric,
                      string,
                    ][]
                  ).map(([key, label]) => (
                    <button
                      type="button"
                      key={key}
                      aria-pressed={metric === key}
                      className={metric === key ? "selected" : ""}
                      onClick={() => {
                        setMetric(key);
                        setSearch("");
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="panel-heading">
                  <h2
                    aria-label={
                      analysisMetrics[metric] + " " + filtered.length + "종목"
                    }
                  >
                    {filtered.length}
                    <span className="muted">종목</span>
                  </h2>
                  <button
                    className="analysis-screen-trigger"
                    type="button"
                    onClick={showScreener}
                  >
                    조건 검색
                  </button>
                  <label className="analysis-search">
                    <Search size={16} />
                    <input
                      aria-label="분석 종목 검색"
                      placeholder="종목·테마 검색"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                </div>
                <p className="analysis-metric-note" role="status">
                  {metric === "surge"
                    ? "전일 하루 거래량 대비 배수 · 같은 시간대 비교가 아닙니다. "
                    : metric === "turnover"
                      ? "거래된 금액이 큰 순서입니다. "
                      : metric === "volume"
                        ? "거래된 주식 수가 많은 순서입니다. "
                        : isLimit
                          ? "장중 누적 포착 · 가격은 마지막 도달 확인 시점 기준입니다. "
                          : "전일 종가 대비 등락률 순서입니다. "}
                  <span>수집 {time(report.sections[metric].collectedAt)}</span>
                </p>
                {report.sections[metric].error && (
                  <p className="analysis-notice" role="alert">
                    {report.sections[metric].error}
                    {rows.length
                      ? " 기존 포착 기록을 표시합니다."
                      : " 다른 지표를 선택하거나 다시 조회해주세요."}
                  </p>
                )}
                {!filtered.length ? (
                  <div className="empty">
                    {report.sections[metric].error
                      ? "현재 이 지표의 조회 결과를 확인할 수 없습니다."
                      : search
                        ? "조건에 맞는 종목이 없습니다."
                        : "이 조회에서 포착된 종목이 없습니다."}
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table
                      className="responsive-table analysis-table"
                      role="table"
                      aria-label={analysisMetrics[metric] + " 목록"}
                    >
                      <thead role="rowgroup">
                        <tr role="row">
                          {[
                            "종목",
                            priceLabel,
                            rateLabel,
                            "거래량",
                            "거래대금",
                            "전일 거래량 대비",
                            ...(metric === "upper" || metric === "lower"
                              ? ["포착 기록"]
                              : []),
                          ].map((label) => (
                            <th key={label} scope="col" role="columnheader">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody role="rowgroup">
                        {visible.map((row) => (
                          <tr
                            key={row.symbol}
                            role="row"
                            className={
                              "analysis-result " +
                              (expandedRows.has(row.symbol)
                                ? "is-expanded"
                                : "")
                            }
                          >
                            <td data-label="종목" role="cell">
                              <button
                                type="button"
                                className="table-link"
                                disabled={!availableSymbols.has(row.symbol)}
                                onClick={() => onSelect(row.symbol)}
                              >
                                {row.name} <ArrowUpRight size={13} />
                              </button>
                              <small>
                                {row.symbol} · {row.market}
                              </small>
                              <small className="analysis-row-themes">
                                {(themeIndex.get(row.symbol) ?? [])
                                  .slice(0, 2)
                                  .map((theme) => theme.name)
                                  .join(" · ")}
                              </small>
                            </td>
                            <td
                              data-label={priceLabel}
                              role="cell"
                              className="analysis-price"
                            >
                              {number(row.price)}원
                            </td>
                            <td
                              data-label={rateLabel}
                              role="cell"
                              className={
                                "analysis-rate " +
                                color(row.changeRate) +
                                primaryClass("rate")
                              }
                            >
                              {percent(row.changeRate)}
                            </td>
                            <td
                              data-label="거래량"
                              role="cell"
                              className={
                                "analysis-detail analysis-volume" +
                                primaryClass("volume")
                              }
                            >
                              {compact(row.volume, "주")}
                            </td>
                            <td
                              data-label="거래대금"
                              role="cell"
                              className={
                                "analysis-turnover" + primaryClass("turnover")
                              }
                            >
                              {compact(row.turnover, "원")}
                            </td>
                            <td
                              data-label="전일 거래량 대비"
                              role="cell"
                              className={
                                "analysis-detail analysis-ratio" +
                                primaryClass("ratio")
                              }
                            >
                              {row.volumeRatio === null
                                ? "—"
                                : row.volumeRatio.toFixed(2) + "배"}
                            </td>
                            {"firstSeen" in row && (
                              <td
                                data-label="포착 기록"
                                role="cell"
                                className="analysis-status"
                              >
                                <span
                                  className={
                                    "limit-badge " +
                                    (data.stale ||
                                    report.sections[metric].error ||
                                    row.active === null
                                      ? "unknown"
                                      : row.active
                                        ? "reached"
                                        : "recorded")
                                  }
                                >
                                  {data.stale ||
                                  report.sections[metric].error ||
                                  row.active === null
                                    ? "조회 지연"
                                    : row.active
                                      ? "최근 수집 때 도달"
                                      : "장중 포착"}
                                </span>
                                <span className="limit-times">
                                  <small>최초 포착 {time(row.firstSeen)}</small>
                                  <small>
                                    마지막 도달 {time(row.lastSeen)}
                                  </small>
                                </span>
                              </td>
                            )}
                            <td className="analysis-more" role="cell">
                              <button
                                type="button"
                                aria-label={row.name + " 상세"}
                                aria-expanded={expandedRows.has(row.symbol)}
                                onClick={() =>
                                  setExpandedRows((values) => {
                                    const next = new Set(values);
                                    if (next.has(row.symbol))
                                      next.delete(row.symbol);
                                    else next.add(row.symbol);
                                    return next;
                                  })
                                }
                              >
                                {expandedRows.has(row.symbol)
                                  ? "접기"
                                  : "상세 보기"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {pages > 1 && (
                  <div className="stock-pagination">
                    <button
                      type="button"
                      disabled={currentPage === 0}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      이전
                    </button>
                    <span>
                      {currentPage + 1} / {pages}
                    </span>
                    <button
                      type="button"
                      disabled={currentPage + 1 >= pages}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      다음
                    </button>
                  </div>
                )}
                <p className="analysis-footnote">
                  {report.source === "demo"
                    ? "샘플 지표이며 실제 시장 움직임이 아닙니다. "
                    : "KRX 시세 · 한국투자증권 제공 순위의 상위 조회 목록 기준입니다. "}
                  {isLimit &&
                    "포착 목록의 가격·등락률·거래량은 최근 도달 확인 시점의 값입니다. "}
                  상·하한가 포착은 수집 이후 누적하며, 5분 수집 간격 사이에 잠깐
                  도달한 종목은 누락될 수 있습니다. —는 미제공 값입니다. 과거
                  기록은 수집을 시작한 날부터 확인할 수 있습니다.
                </p>
              </section>
            )}
            <AnalysisInsights
              key={market + ":" + date}
              report={report}
              themes={themes}
              onSelect={onSelect}
              availableSymbols={availableSymbols}
              section={tab}
              onShowStocks={showScreener}
            />
            <MarketNews
              report={report}
              themes={themes}
              availableSymbols={availableSymbols}
              onSelect={onSelect}
              onNewsSelect={onNewsSelect}
              active={tab === "news"}
            />
          </div>
        </>
      )}
    </div>
  );
}
