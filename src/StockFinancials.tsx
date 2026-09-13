import { useEffect, useState, type CSSProperties } from "react";
import { BarChart3, ExternalLink, RefreshCw } from "lucide-react";
import EtfDetails from "./EtfDetails";
import StockResearch from "./StockResearch";
import {
  derivePeriods,
  shiftQuarter,
  type FinancialView,
} from "./financialPeriods";
import {
  financialDate,
  financialLabels,
  margin,
  sectionLabels,
  yearComparison,
  type FinancialMetric,
  type FinancialPeriod,
  type FinancialRow,
  type StockFinancials as FinancialData,
} from "./financialTypes";
import "./stock-financials.css";

const number = (value: number | null | undefined, suffix = "") =>
  value === null || value === undefined
    ? "—"
    : value.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + suffix;
const money = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "자료 없음"
    : Math.abs(value) >= 10000
      ? number(value / 10000, "조 원")
      : number(value, "억 원");
const timestamp = (value: number | null | undefined) =>
  value
    ? new Date(value).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }) + " KST"
    : "미수신";

export default function StockFinancials({
  symbol,
  name,
  instrument,
  active,
}: {
  symbol: string;
  name: string;
  instrument?: "stock" | "etf";
  active: boolean;
}) {
  const [view, setView] = useState<FinancialView>("annual");
  const period: FinancialPeriod = view === "annual" ? "annual" : "quarter";
  const [analysisTab, setAnalysisTab] = useState("financials");
  const derived = view === "single" || view === "ttm";
  const [data, setData] = useState<FinancialData | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const [selected, setSelected] = useState(""),
    [compare, setCompare] = useState("");
  const [metric, setMetric] = useState<
    "revenue" | "operatingProfit" | "netIncome"
  >("revenue");
  useEffect(() => {
    if (!active || instrument === "etf" || analysisTab !== "financials") return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/financials/${encodeURIComponent(symbol)}?period=${period}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok)
          throw Error(value.error || "재무정보를 불러오지 못했습니다.");
        if (value.symbol !== symbol || value.period !== period)
          throw Error("선택한 종목과 기간의 자료를 다시 조회해주세요.");
        return value as FinancialData;
      })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [symbol, period, active, instrument, reload, analysisTab]);
  const info = data?.symbol === symbol && data.period === period ? data : null;
  const rows = info
    ? derived
      ? derivePeriods(
          info.rows,
          view as "single" | "ttm",
          info.valuation?.fiscalMonth ?? null,
        )
      : info.rows
    : [];
  const current =
    rows.find((row) => row.date === selected) ??
    rows.find((row) => row.revenue !== null || row.operatingProfit !== null) ??
    rows[0];
  const priorYear = current
    ? String(Number(current.date.slice(0, 4)) - 1) + current.date.slice(4)
    : "";
  const previousYear = rows.find((row) => row.date === priorYear);
  const comparison =
    rows.find((row) => row.date === compare && row.date !== current?.date) ??
    previousYear ??
    rows.find((row) => current && row.date < current.date);
  const quote = info?.valuation;
  const issues =
    info?.sections.filter((section) => section.status !== "ok") ?? [];
  return (
    <>
      <div className="panel-heading financial-heading">
        <div>
          <h2>
            <BarChart3 size={18} /> {name} 종목 분석
          </h2>
          <p>
            {symbol} ·{" "}
            {instrument === "etf"
              ? "ETF 상품 정보"
              : "실적과 재무상태를 함께 살펴보세요"}
          </p>
        </div>
        {instrument !== "etf" && (
          <button
            type="button"
            className="financial-refresh"
            aria-label="재무정보 새로고침"
            disabled={analysisTab === "financials" && loading}
            onClick={() => setReload((value) => value + 1)}
          >
            <RefreshCw size={16} />
            <span>
              {analysisTab === "financials" && loading ? "조회 중" : "새로고침"}
            </span>
          </button>
        )}
      </div>
      {instrument !== "etf" && (
        <div className="research-tabs" role="group" aria-label="종목 분석 메뉴">
          {[
            ["financials", "재무 요약"],
            ["dart", "공시 재무"],
            ["peers", "기업 비교"],
            ["flows", "투자자 수급"],
            ["events", "공시·배당"],
            ["estimates", "예상 실적"],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={analysisTab === key}
              onClick={(event) => {
                setAnalysisTab(key);
                if (window.matchMedia("(max-width: 600px)").matches) {
                  const menu = event.currentTarget.closest(".research-tabs");
                  requestAnimationFrame(() =>
                    menu?.scrollIntoView({ block: "start" }),
                  );
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {instrument === "etf" ? (
        <div className="financial-content">
          <p className="financial-note">
            ETF는 여러 자산을 담은 펀드입니다. 기업의 매출·이익 대신
            순자산가치와 추종 지수를 확인하세요.
          </p>
          {active && <EtfDetails symbol={symbol} />}
        </div>
      ) : analysisTab !== "financials" ? (
        <StockResearch
          key={symbol + analysisTab}
          symbol={symbol}
          name={name}
          section={analysisTab}
          active={active}
          reload={reload}
        />
      ) : (
        <div className="financial-content">
          {info?.source === "demo" && (
            <p className="financial-demo" role="status">
              데모 재무자료 · 화면 확인을 위한 가상 수치이며 실제 기업 실적이
              아닙니다.
            </p>
          )}
          {error && (
            <p className="financial-notice" role="alert">
              {error}{" "}
              {info
                ? "이전 조회 자료를 표시하고 있습니다."
                : "새로고침으로 다시 시도해주세요."}
            </p>
          )}
          <section
            className="financial-valuations"
            aria-label="조회 시점 투자지표"
          >
            <div className="financial-subheading">
              <h3>투자지표</h3>
              <small>
                조회{" "}
                {timestamp(
                  info?.sections.find((s) => s.kind === "valuation")
                    ?.receivedAt,
                )}
              </small>
            </div>
            <dl className="financial-metrics">
              {[
                ["시가총액", money(quote?.marketCap), "조회 시점 기업 가치"],
                ["PER", number(quote?.per, "배"), "주가 ÷ 주당순이익"],
                ["PBR", number(quote?.pbr, "배"), "주가 ÷ 주당순자산"],
                ["EPS", number(quote?.eps, "원"), "주당순이익"],
                ["BPS", number(quote?.bps, "원"), "주당순자산"],
                [
                  "외국인 소진율",
                  number(quote?.foreignOwnership, "%"),
                  "외국인 한도 대비 보유",
                ],
              ].map(([label, value, note]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{loading && !info ? "조회 중" : value}</dd>
                  <small>{note}</small>
                </div>
              ))}
            </dl>
            <p className="financial-note">
              KIS 조회 시점의 지표입니다. 아래에서 선택한 결산 기간의 배수로
              재계산한 값은 아닙니다.
            </p>
          </section>
          <div
            className="financial-period"
            role="group"
            aria-label="재무 조회 기간"
          >
            {(
              [
                ["annual", "연간"],
                ["quarter", "분기 누적"],
                ["single", "단일 분기"],
                ["ttm", "최근 12개월"],
              ] as const
            ).map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-pressed={view === key}
                onClick={() => {
                  setView(key);
                  setSelected("");
                  setCompare("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="financial-basis">
            {derived
              ? "누적 실적에서 계산한 추정치입니다. KIS 자료는 연결·별도 구분과 정정 이력을 제공하지 않아 회계 기준의 일치를 확인할 수 없습니다. 12월 결산 종목만 계산하며 필요한 분기가 하나라도 없으면 표시하지 않습니다. "
              : period === "quarter"
                ? "분기 손익은 연초부터 해당 결산일까지 누적한 실적입니다. 단일 분기 실적과 구분해 보세요."
                : info?.valuation?.fiscalMonth
                  ? `${info.valuation.fiscalMonth}월 결산 자료입니다. 연간 조회에 포함된 중간결산은 제외했습니다.`
                  : "연간 조회 자료입니다. 결산 월 미확인으로 중간결산이 포함될 수 있습니다."}{" "}
            재무상태표는 결산 시점의 잔액입니다.
          </p>
          {derived && (
            <p className="financial-note research-formula">
              {view === "single"
                ? "1분기 = 3월 누적 · 2분기 = 반기 − 1분기 · 3분기 = 9월 누적 − 반기 · 4분기 = 연간 − 9월 누적"
                : "TTM = 선택한 결산까지 연속된 4개 단일 분기 손익의 합계"}
              {info &&
                info.valuation?.fiscalMonth !== 12 &&
                " · 이 종목은 12월 결산이 확인되지 않아 계산할 수 없습니다."}
            </p>
          )}
          {period === "annual" && !!info?.interimDates.length && (
            <button
              className="financial-interim"
              type="button"
              onClick={() => {
                setView("quarter");
                setSelected("");
                setCompare("");
              }}
            >
              최근 {financialDate(info.interimDates[0])} 중간결산은 분기
              누적에서 보기 →
            </button>
          )}
          {loading && !info && (
            <p className="financial-loading" role="status">
              재무정보를 불러오고 있습니다…
            </p>
          )}
          {issues.length > 0 && (
            <div className="financial-notice" role="status">
              {issues.map((section) => (
                <p key={section.kind}>
                  {sectionLabels[section.kind]}:{" "}
                  {section.status === "empty"
                    ? "제공된 자료가 없습니다."
                    : section.status === "stale"
                      ? `갱신 지연 · ${timestamp(section.receivedAt)}에 받은 이전 자료입니다.`
                      : "조회에 실패했습니다. 새로고침으로 다시 시도해주세요."}
                </p>
              ))}
            </div>
          )}
          {info && !rows.length && (
            <p className="financial-empty">
              표시할 재무제표가 없습니다. 상장 초기이거나 제공처에서 재무자료를
              제공하지 않는 종목일 수 있습니다.
            </p>
          )}
          {current && (
            <>
              <div className="financial-date-controls">
                <label>
                  기준 결산
                  <select
                    aria-label="기준 결산"
                    value={current.date}
                    onChange={(event) => {
                      setSelected(event.target.value);
                      setCompare("");
                    }}
                  >
                    {rows.map((row) => (
                      <option key={row.date} value={row.date}>
                        {financialDate(row.date)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  비교 결산
                  <select
                    aria-label="비교 결산"
                    disabled={rows.length < 2}
                    value={comparison?.date ?? ""}
                    onChange={(event) => setCompare(event.target.value)}
                  >
                    <option value="" disabled>
                      비교 자료 없음
                    </option>
                    {rows
                      .filter((row) => row.date !== current.date)
                      .map((row) => (
                        <option key={row.date} value={row.date}>
                          {financialDate(row.date)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <section aria-label="주요 실적" className="financial-earnings">
                <div className="financial-subheading">
                  <h3>
                    {financialDate(current.date)}{" "}
                    {view === "single"
                      ? "단일 분기 실적 · 추정"
                      : view === "ttm"
                        ? "최근 12개월 실적 · 추정"
                        : period === "annual"
                          ? info?.valuation?.fiscalMonth
                            ? "연간 실적"
                            : "결산 자료"
                          : "누적 실적"}
                  </h3>
                  <small>금액: 억 원</small>
                </div>
                <dl className="financial-metrics financial-profit-metrics">
                  {(["revenue", "operatingProfit", "netIncome"] as const).map(
                    (key) => (
                      <div key={key}>
                        <dt>{financialLabels[key]}</dt>
                        <dd
                          className={
                            current[key] !== null && current[key]! < 0
                              ? "down"
                              : ""
                          }
                        >
                          {money(current[key])}
                        </dd>
                        <small>
                          {yearComparison(
                            current[key],
                            previousYear?.[key] ?? null,
                            key !== "revenue",
                          )}
                        </small>
                        {view === "single" && (
                          <small>
                            {yearComparison(
                              current[key],
                              rows.find(
                                (row) =>
                                  row.date === shiftQuarter(current.date, -1),
                              )?.[key] ?? null,
                              key !== "revenue",
                            ).replaceAll("전년 동기", "전분기")}
                          </small>
                        )}
                      </div>
                    ),
                  )}
                </dl>
              </section>
              <section className="financial-chart" aria-label="실적 추이">
                <div className="financial-subheading">
                  <h3>실적 추이</h3>
                  <small>
                    {view === "quarter"
                      ? "각 결산일까지 누적 · "
                      : view === "single"
                        ? "단일 분기 추정 · "
                        : view === "ttm"
                          ? "최근 12개월 추정 · "
                          : ""}
                    억 원
                  </small>
                </div>
                <div
                  className="financial-chart-metrics"
                  role="group"
                  aria-label="추이 지표"
                >
                  {(["revenue", "operatingProfit", "netIncome"] as const).map(
                    (key) => (
                      <button
                        type="button"
                        key={key}
                        aria-pressed={key === metric}
                        onClick={() => setMetric(key)}
                      >
                        {financialLabels[key]}
                      </button>
                    ),
                  )}
                </div>
                <FinancialTrend
                  rows={rows.slice(0, 6).reverse()}
                  metric={metric}
                  selected={current.date}
                  onSelect={(date) => {
                    setSelected(date);
                    setCompare("");
                  }}
                />
                <p className="financial-note">
                  막대를 선택하면 해당 결산의 상세 수치를 볼 수 있어요.
                </p>
              </section>
              <div className="financial-statements">
                <FinancialTable
                  title="손익계산서"
                  fields={[
                    "revenue",
                    "costOfSales",
                    "grossProfit",
                    "operatingProfit",
                    "netIncome",
                  ]}
                  current={current}
                  comparison={comparison}
                  period={view}
                  margins
                />
                <FinancialTable
                  title="재무상태표"
                  fields={[
                    "assets",
                    "liabilities",
                    "equity",
                    "currentAssets",
                    "fixedAssets",
                    "currentLiabilities",
                    "fixedLiabilities",
                  ]}
                  current={current}
                  comparison={comparison}
                  period={view}
                />
                {!derived && (
                  <FinancialTable
                    title="재무비율"
                    fields={["roe", "debtRatio", "eps", "bps"]}
                    current={current}
                    comparison={comparison}
                    period={view}
                  />
                )}
              </div>
            </>
          )}
          <details className="financial-guide">
            <summary>재무지표 읽는 법·자료 기준</summary>
            <dl>
              <div>
                <dt>영업이익률·순이익률</dt>
                <dd>
                  각 이익을 같은 기간의 매출액으로 나눈 비율입니다. 매출이 0
                  이하이거나 자료가 없으면 계산하지 않습니다.
                </dd>
              </div>
              <div>
                <dt>PER·PBR</dt>
                <dd>
                  각각 이익·순자산에 비해 주가가 어느 수준인지 보는 지표입니다.
                  낮은 배수만으로 저평가를 판단할 수 없습니다. 제공된 값이 0
                  이하이면 배수는 표시하지 않습니다.
                </dd>
              </div>
              <div>
                <dt>ROE·부채비율</dt>
                <dd>
                  ROE는 자기자본 대비 이익 수준, 부채비율은 자기자본 대비 부채
                  수준을 나타냅니다. 업종과 회계 기준을 함께 확인하세요.
                </dd>
              </div>
              <div>
                <dt>결산·자료 기준</dt>
                <dd>
                  KIS 제공 기준이며 연결·별도 구분은 응답에 포함되지 않습니다.
                  결산일은 공시일이 아닙니다. 서로 다른 결산의 값을 임의로
                  채우지 않으며, ‘—’는 자료 없음 또는 계산 불가를 뜻합니다.
                </dd>
              </div>
              <div>
                <dt>공시 원문</dt>
                <dd>
                  이 화면은 손익·재무상태·재무비율 요약입니다. 현금흐름표와
                  주석, 정정공시, 상세 회계 기준은 DART 원문에서 확인하세요.
                </dd>
              </div>
            </dl>
            <a
              href="https://dart.fss.or.kr/"
              target="_blank"
              rel="noopener noreferrer"
            >
              DART 공시 확인 <ExternalLink size={14} />
            </a>
          </details>
          {info && (
            <footer className="financial-source">
              <span>
                {info.source === "demo"
                  ? "가상 예시 자료"
                  : "자료: 한국투자증권"}{" "}
                · 금액 단위: 억 원 · EPS/BPS: 원
              </span>
              {info.sections
                .filter((s) => s.kind !== "valuation")
                .map((s) => (
                  <span key={s.kind}>
                    {sectionLabels[s.kind]} 조회 {timestamp(s.receivedAt)}
                  </span>
                ))}
            </footer>
          )}
        </div>
      )}
    </>
  );
}

function FinancialTrend({
  rows,
  metric,
  selected,
  onSelect,
}: {
  rows: FinancialRow[];
  metric: "revenue" | "operatingProfit" | "netIncome";
  selected: string;
  onSelect: (date: string) => void;
}) {
  const values = rows
    .map((row) => row[metric])
    .filter((value): value is number => value !== null);
  if (!values.length)
    return <p className="financial-empty">이 지표의 추이 자료가 없습니다.</p>;
  const max = Math.max(0, ...values),
    min = Math.min(0, ...values),
    span = max - min || 1;
  const zero = (max / span) * 132;
  return (
    <div
      className="financial-bars"
      style={{ "--zero": zero + "px" } as CSSProperties}
    >
      {rows.map((row) => {
        const value = row[metric],
          y = ((max - (value ?? 0)) / span) * 132;
        return (
          <button
            key={row.date}
            type="button"
            className={value !== null && value < 0 ? "negative" : ""}
            aria-label={`${financialDate(row.date)} ${financialLabels[metric]} ${money(value)}`}
            aria-pressed={selected === row.date}
            onClick={() => onSelect(row.date)}
            title={`${financialDate(row.date)} · ${money(value)}`}
          >
            <span className="financial-bar-track">
              <i
                style={{
                  top: Math.min(y, zero),
                  height: value === null ? 0 : Math.max(2, Math.abs(y - zero)),
                }}
              />
              {value === null && <small>—</small>}
            </span>
            <span>{financialDate(row.date)}</span>
          </button>
        );
      })}
    </div>
  );
}
function FinancialTable({
  title,
  fields,
  current,
  comparison,
  period,
  margins,
}: {
  title: string;
  fields: FinancialMetric[];
  current: FinancialRow;
  comparison?: FinancialRow;
  period: FinancialView;
  margins?: boolean;
}) {
  const unit =
    title === "재무비율" ? "ROE·부채비율: % / EPS·BPS: 원" : "단위: 억 원";
  return (
    <section className="financial-statement">
      <div className="financial-subheading">
        <h3>
          {title}
          {margins
            ? period === "quarter"
              ? " · 누적"
              : period === "single"
                ? " · 단일 분기 추정"
                : period === "ttm"
                  ? " · 최근 12개월 추정"
                  : ""
            : ""}
        </h3>
        <small>{unit}</small>
      </div>
      <table aria-label={title}>
        <thead>
          <tr>
            <th scope="col">항목</th>
            <th scope="col">
              {financialDate(current.date)}
              <small>기준</small>
            </th>
            <th scope="col">
              {comparison ? financialDate(comparison.date) : "—"}
              <small>비교</small>
            </th>
          </tr>
        </thead>
        <tbody>
          {fields.map((key) => (
            <tr key={key}>
              <th scope="row">{financialLabels[key]}</th>
              {[current, comparison].map((row, i) => (
                <td
                  key={i}
                  className={
                    row?.[key] !== null && (row?.[key] ?? 0) < 0 ? "down" : ""
                  }
                >
                  {number(row?.[key])}
                </td>
              ))}
            </tr>
          ))}
          {margins &&
            (
              [
                ["영업이익률 (%)", "operatingProfit"],
                ["순이익률 (%)", "netIncome"],
              ] as const
            ).map(([label, key]) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                {[current, comparison].map((row, i) => (
                  <td key={i}>
                    {number(row ? margin(row[key], row.revenue) : null)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
}
