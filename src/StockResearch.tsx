import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { financialDate, margin, yearComparison } from "./financialTypes";
import {
  dartReportNames,
  flowTotals,
  type DartAccount,
  type DartBasis,
  type DartReport,
  type DartStatement,
  type Dividends,
  type Estimates,
  type Filings,
  type InvestorDay,
  type InvestorFlows,
  type PeerComparison,
  type ResearchResult,
} from "./researchTypes";
import "./stock-research.css";

const n = (value: number | null | undefined, suffix = "") =>
  value == null
    ? "—"
    : value.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + suffix;
const signed = (value: number | null | undefined) =>
  value == null ? "—" : (value > 0 ? "+" : "") + n(value);
const dayLabel = (date: string | null | undefined) =>
  date
    ? date.slice(0, 4) + "." + date.slice(4, 6) + "." + date.slice(6, 8)
    : "미제공";
const amount = (value: number | null | undefined) =>
  value == null
    ? "—"
    : Math.abs(value) >= 10000
      ? n(value / 10000, "조 원")
      : n(value, "억 원");
type Props = { symbol: string; name: string; active: boolean; reload: number };
type Load<T> = {
  result: ResearchResult<T> | null;
  loading: boolean;
  error: string;
};
function useResearch<T>(
  symbol: string,
  section: string,
  active: boolean,
  reload: number,
  query = "",
): Load<T> {
  const key = symbol + "/" + section + "?" + query;
  const [state, setState] = useState<{
    key: string;
    result: ResearchResult<T>;
  } | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(
      "/api/research/" +
        encodeURIComponent(symbol) +
        "/" +
        section +
        "?" +
        query,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw Error(data.error || "분석 자료를 불러오지 못했습니다.");
        if (data.symbol !== symbol || data.section !== section)
          throw Error("선택한 종목의 자료를 다시 조회해주세요.");
        if (!controller.signal.aborted) setState({ key, result: data });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [symbol, section, key, query, active, reload]);
  return { result: state?.key === key ? state.result : null, loading, error };
}
function Status<T>({ load, empty }: { load: Load<T>; empty: string }) {
  const { result, loading, error } = load;
  return (
    <>
      {loading && !result && (
        <p role="status" className="financial-loading">
          분석 자료를 불러오고 있습니다…
        </p>
      )}
      {error && (
        <p role="alert" className="financial-notice">
          {error}
          {result?.data
            ? " 이전 조회 자료를 표시하고 있습니다."
            : " 상단 새로고침으로 다시 시도해주세요."}
        </p>
      )}
      {result?.source === "demo" && (
        <p className="financial-demo">
          데모 분석 자료 · 실제 기업의 수치가 아닙니다.
        </p>
      )}
      {result?.status === "error" && (
        <p role="status" className="financial-notice">
          제공처 자료를 불러오지 못했습니다. 잠시 후 상단 새로고침으로 다시
          시도해주세요.
        </p>
      )}
      {result?.status === "stale" && (
        <p role="status" className="financial-notice">
          갱신이 지연되어 이전 조회 자료를 표시하고 있습니다. 아래 수신 시점을
          확인하세요.
        </p>
      )}
      {result?.status === "empty" && <p className="financial-empty">{empty}</p>}
      {result?.status === "unconfigured" && (
        <div className="research-pending">
          <strong>DART 공시 데이터 연결 대기</strong>
          <p>
            연결되면 공시 원문과 연결·별도 재무제표를 이곳에서 확인할 수
            있습니다.
          </p>
          <a
            href="https://dart.fss.or.kr/"
            target="_blank"
            rel="noopener noreferrer"
          >
            DART에서 확인 <ExternalLink size={14} />
          </a>
        </div>
      )}
    </>
  );
}
function Source<T>({ load }: { load: Load<T> }) {
  const result = load.result;
  if (!result?.receivedAt) return null;
  return (
    <p className="financial-source">
      자료:{" "}
      {result.source === "dart"
        ? "금융감독원 OpenDART"
        : result.source === "demo"
          ? "가상 예시"
          : "한국투자증권"}{" "}
      · 수신{" "}
      {new Date(result.receivedAt).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
      })}{" "}
      KST
    </p>
  );
}
export default function StockResearch(props: Props & { section: string }) {
  return (
    <div className="financial-content stock-research">
      {props.section === "flows" ? (
        <Flows {...props} />
      ) : props.section === "peers" ? (
        <Peers {...props} />
      ) : props.section === "events" ? (
        <Events {...props} />
      ) : props.section === "estimates" ? (
        <Forecasts {...props} />
      ) : (
        <DartFinancials {...props} />
      )}
    </div>
  );
}

function Flows(props: Props) {
  const load = useResearch<InvestorFlows>(
    props.symbol,
    "flows",
    props.active,
    props.reload,
  );
  const [days, setDays] = useState(5),
    [selected, setSelected] = useState("");
  const rows = load.result?.data?.rows ?? [],
    window = rows.slice(0, days),
    total = flowTotals(rows, days);
  const current = window.find((row) => row.date === selected) ?? window[0];
  return (
    <section aria-label="투자자별 수급 분석">
      <h3>외국인·기관은 얼마나 사고팔았을까요?</h3>
      <p className="financial-basis">
        KRX 기준 순매수 수량입니다. 양수는 순매수, 음수는 순매도이며 금액이 아닌
        주식 수로 표시합니다.
      </p>
      <Status load={load} empty="집계된 투자자 수급 자료가 없습니다." />
      {rows.length > 0 && (
        <>
          <div
            className="research-controls"
            role="group"
            aria-label="수급 집계 기간"
          >
            {[1, 5, 20].map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={days === value}
                onClick={() => {
                  setDays(value);
                  setSelected("");
                }}
              >
                최근 {value}거래일
              </button>
            ))}
          </div>
          <p className="financial-basis">
            {dayLabel(window.at(-1)?.date)} ~ {dayLabel(window[0]?.date)} ·{" "}
            {total.count}거래일 수신
            {total.count < days &&
              ` / ${days}거래일이 모두 수신되지 않아 합계를 표시하지 않습니다.`}
          </p>
          {!!load.result?.data?.pendingDates.length && (
            <p className="financial-notice">
              {load.result.data.pendingDates.map(dayLabel).join(", ")} 수급은
              아직 집계되지 않았습니다. 집계된 최근 거래일까지 표시합니다.
            </p>
          )}
          <dl className="financial-metrics research-summary">
            {(
              [
                ["foreign", "외국인"],
                ["institution", "기관"],
                ["individual", "개인"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <dt>{label} 순매수</dt>
                <dd
                  className={
                    (total[key] ?? 0) < 0
                      ? "down"
                      : (total[key] ?? 0) > 0
                        ? "up"
                        : ""
                  }
                >
                  {signed(total[key])}
                  <small> 주</small>
                </dd>
                <small>
                  {days}거래일 합계{total[key] === null && " · 자료 부족"}
                </small>
              </div>
            ))}
          </dl>
          <FlowChart rows={[...window].reverse()} />
          <div className="research-day-controls">
            <label>
              일별 수급 확인
              <select
                aria-label="수급 기준일"
                value={current?.date ?? ""}
                onChange={(e) => setSelected(e.target.value)}
              >
                {window.map((row) => (
                  <option key={row.date} value={row.date}>
                    {dayLabel(row.date)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {current && (
            <dl className="research-day-values">
              {[
                ["종가", n(current.close, "원")],
                ["외국인", signed(current.foreign) + " 주"],
                ["기관", signed(current.institution) + " 주"],
                ["개인", signed(current.individual) + " 주"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="financial-note">
            당일 수급은 장 마감 후에도 변경될 수 있습니다. 누락된 수치는 0으로
            계산하지 않습니다.
          </p>
        </>
      )}
      <Source load={load} />
    </section>
  );
}
function FlowChart({ rows }: { rows: InvestorDay[] }) {
  const max = Math.max(
    1,
    ...rows.flatMap((row) => [
      Math.abs(row.foreign ?? 0),
      Math.abs(row.institution ?? 0),
    ]),
  );
  const width = 560 / Math.max(rows.length, 1),
    closes = rows
      .map((row) => row.close)
      .filter((value): value is number => value !== null && value > 0);
  const minPrice = Math.min(...closes),
    maxPrice = Math.max(...closes),
    priceSpan = maxPrice - minPrice || 1;
  const prices = rows.map((row, i) => ({
    x: 20 + width * (i + 0.5),
    y:
      row.close === null || row.close <= 0
        ? null
        : 60 - ((row.close - minPrice) / priceSpan) * 42,
  }));
  return (
    <div className="research-flow-chart">
      <div className="financial-subheading">
        <h4>일별 순매수 추이</h4>
        <span className="research-legend">
          <i className="foreign" />
          외국인 <i className="institution" />
          기관
        </span>
      </div>
      <svg
        viewBox="0 0 600 184"
        role="img"
        aria-label="외국인과 기관의 일별 순매수 수량 막대그래프. 상세 수치는 아래 기준일 선택에서 확인할 수 있습니다."
      >
        <line x1="12" y1="88" x2="588" y2="88" stroke="var(--line)" />
        <text x="6" y="84" fill="var(--muted)" fontSize="11">
          0
        </text>
        {rows.map((row, i) => (
          <g key={row.date}>
            {(["foreign", "institution"] as const).map((key, k) => {
              const value = row[key],
                height = (Math.abs(value ?? 0) / max) * 65;
              return value !== null ? (
                <rect
                  key={key}
                  x={20 + width * i + width * (k === 0 ? 0.12 : 0.52)}
                  y={value >= 0 ? 88 - height : 88}
                  width={Math.max(2, width * 0.32)}
                  height={value === 0 ? 1 : height}
                  fill={key === "foreign" ? "#368cce" : "#ae70cf"}
                >
                  <title>
                    {dayLabel(row.date)} {key === "foreign" ? "외국인" : "기관"}{" "}
                    {signed(value)}주
                  </title>
                </rect>
              ) : null;
            })}
          </g>
        ))}
        <text x="20" y="177" fill="var(--muted)" fontSize="12">
          {dayLabel(rows[0]?.date)}
        </text>
        <text
          x="580"
          y="177"
          textAnchor="end"
          fill="var(--muted)"
          fontSize="12"
        >
          {dayLabel(rows.at(-1)?.date)}
        </text>
      </svg>
      <div className="financial-subheading">
        <h4>같은 기간 종가</h4>
        <small>
          {closes.length
            ? n(minPrice) + " ~ " + n(maxPrice) + "원"
            : "자료 없음"}
        </small>
      </div>
      <svg viewBox="0 0 600 78" role="img" aria-label="같은 기간의 종가 추이">
        {prices.map((point, i) =>
          point.y !== null && prices[i - 1]?.y != null ? (
            <line
              key={i}
              x1={prices[i - 1].x}
              y1={prices[i - 1].y!}
              x2={point.x}
              y2={point.y}
              stroke="var(--accent)"
              strokeWidth="2.5"
            />
          ) : null,
        )}
        {prices.map(
          (point, i) =>
            point.y !== null && (
              <circle
                key={i}
                cx={point.x}
                cy={point.y}
                r="2.5"
                fill="var(--accent)"
              />
            ),
        )}
      </svg>
    </div>
  );
}

function Peers(props: Props) {
  const [selected, setSelected] = useState<string[]>([]),
    [search, setSearch] = useState("");
  const [stocks, setStocks] = useState<
      { symbol: string; name: string; instrument?: string }[]
    >([]),
    [searchError, setSearchError] = useState("");
  useEffect(() => {
    if (!props.active) return;
    const controller = new AbortController();
    setSearchError("");
    fetch("/api/stocks", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error();
        const data = await response.json();
        if (!controller.signal.aborted)
          setStocks(
            data.stocks.filter(
              (stock: { instrument?: string }) => stock.instrument !== "etf",
            ),
          );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setSearchError(
            "종목 목록을 불러오지 못했습니다. 상단 새로고침으로 다시 시도해주세요.",
          );
      });
    return () => controller.abort();
  }, [props.active, props.reload]);
  const load = useResearch<PeerComparison>(
    props.symbol,
    "peers",
    props.active,
    props.reload,
    "symbols=" + selected.join(","),
  );
  const data = load.result?.data,
    companies = data?.companies ?? [];
  const matches = search.trim()
    ? stocks
        .filter(
          (stock) =>
            stock.symbol !== props.symbol &&
            !selected.includes(stock.symbol) &&
            (stock.name.toLowerCase().includes(search.trim().toLowerCase()) ||
              stock.symbol.includes(search.trim())),
        )
        .slice(0, 6)
    : [];
  const industry = companies[0]?.profile.data?.industryCode;
  return (
    <section aria-label="기업 비교 분석">
      <h3>같은 결산으로 기업 비교</h3>
      <p className="financial-basis">
        기준 종목을 포함해 최대 3개 기업을 비교합니다. 비교할 기업을 직접
        선택하고, 표시된 표준산업분류를 함께 확인하세요.
      </p>
      <div className="research-selected">
        <span>{props.name} · 기준</span>
        {selected.map((symbol) => (
          <button
            type="button"
            key={symbol}
            onClick={() =>
              setSelected((list) => list.filter((code) => code !== symbol))
            }
            aria-label={`${stocks.find((stock) => stock.symbol === symbol)?.name ?? symbol} 비교에서 제거`}
          >
            {stocks.find((stock) => stock.symbol === symbol)?.name ?? symbol} ×
          </button>
        ))}
      </div>
      <label className="research-search-label">
        비교 기업 추가
        <input
          aria-label="비교 기업 검색"
          placeholder={
            selected.length >= 2
              ? "최대 3개 기업을 선택했습니다"
              : "종목명 또는 코드 검색"
          }
          value={search}
          disabled={selected.length >= 2}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {searchError && (
        <p role="alert" className="financial-notice">
          {searchError}
        </p>
      )}
      {search.trim() && selected.length < 2 && (
        <div className="research-search-results">
          {matches.length ? (
            matches.map((stock) => (
              <button
                type="button"
                key={stock.symbol}
                onClick={() => {
                  setSelected((list) => [...list, stock.symbol].slice(0, 2));
                  setSearch("");
                }}
              >
                {stock.name} <small>{stock.symbol}</small>
                <span>비교에 추가</span>
              </button>
            ))
          ) : (
            <p>검색 결과가 없습니다.</p>
          )}
        </div>
      )}
      <Status load={load} empty="비교 자료가 없습니다." />
      {data && (
        <>
          <p className="financial-basis">
            {data.date
              ? `공통 결산 ${financialDate(data.date)} · 연간 손익 기준`
              : "선택한 기업에 공통으로 제공되는 연간 결산 자료가 없어 실적 비교값을 표시하지 않습니다."}
          </p>
          <div className="research-peer-grid">
            {companies.map((company) => {
              const row = company.financials.rows.find(
                (row) => row.date === data.date,
              );
              const year = data.date
                ? String(+data.date.slice(0, 4) - 1) + data.date.slice(4)
                : "";
              const previous = company.financials.rows.find(
                (row) => row.date === year,
              );
              const quote = company.financials.valuation;
              return (
                <article key={company.symbol} className="research-peer-card">
                  <h4>{company.name}</h4>
                  <p>
                    {company.symbol} ·{" "}
                    {company.profile.data?.industry ?? "산업분류 미제공"}
                  </p>
                  {!!industry &&
                    !!company.profile.data?.industryCode &&
                    industry !== company.profile.data.industryCode && (
                      <small className="research-different">
                        기준 종목과 산업분류가 다릅니다
                      </small>
                    )}
                  {(company.profile.status === "error" ||
                    company.profile.status === "stale" ||
                    company.financials.sections.some(
                      (section) => section.status !== "ok",
                    )) && (
                    <p className="financial-notice">
                      일부 자료가 누락되었거나 갱신이 지연되었습니다.
                    </p>
                  )}
                  <dl>
                    {[
                      ["시가총액", amount(quote?.marketCap)],
                      ["PER", n(quote?.per, "배")],
                      ["PBR", n(quote?.pbr, "배")],
                      ["매출액", amount(row?.revenue)],
                      ["영업이익", amount(row?.operatingProfit)],
                      [
                        "영업이익률",
                        n(
                          row ? margin(row.operatingProfit, row.revenue) : null,
                          "%",
                        ),
                      ],
                      ["ROE", n(row?.roe, "%")],
                      [
                        "매출 성장",
                        yearComparison(
                          row?.revenue ?? null,
                          previous?.revenue ?? null,
                        ).replace("전년 동기 ", ""),
                      ],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <small>
                    투자지표 수신{" "}
                    {company.financials.sections.find(
                      (section) => section.kind === "valuation",
                    )?.receivedAt
                      ? new Date(
                          company.financials.sections.find(
                            (section) => section.kind === "valuation",
                          )!.receivedAt!,
                        ).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
                      : "미수신"}
                  </small>
                </article>
              );
            })}
          </div>
          <p className="financial-note">
            PER·PBR·시가총액은 각 종목의 조회 시점 지표입니다. 손익·ROE는 공통
            결산 자료를 사용합니다. KIS 응답에 연결·별도 구분이 없어 회계 기준의
            일치 여부는 확인할 수 없습니다. 산업분류가 같아도 사업 구조는 다를
            수 있습니다.
          </p>
        </>
      )}
      <Source load={load} />
    </section>
  );
}

function Events(props: Props) {
  const dividends = useResearch<Dividends>(
    props.symbol,
    "dividends",
    props.active,
    props.reload,
  );
  const filings = useResearch<Filings>(
    props.symbol,
    "filings",
    props.active,
    props.reload,
  );
  const [category, setCategory] = useState("전체");
  const entries = filings.result?.data?.rows ?? [],
    categories = ["전체", ...new Set(entries.map((row) => row.category))];
  return (
    <>
      <section aria-label="배당 일정">
        <h3>배당 일정</h3>
        <p className="financial-basis">
          최근 1년부터 앞으로 90일까지의 기준일을 조회합니다. 지급일이 비어
          있으면 미제공으로 표시합니다.
        </p>
        <Status
          load={dividends}
          empty="조회 기간에 제공된 배당 일정이 없습니다. 무배당을 뜻하지는 않습니다."
        />
        <div className="research-event-list">
          {dividends.result?.data?.rows.map((row) => (
            <article key={row.recordDate + row.kind}>
              <div className="financial-subheading">
                <h4>{row.kind} 배당</h4>
                <strong>{n(row.amount, "원 / 주")}</strong>
              </div>
              <dl>
                <div>
                  <dt>배당 기준일</dt>
                  <dd>{dayLabel(row.recordDate)}</dd>
                </div>
                <div>
                  <dt>현금 지급일</dt>
                  <dd>{dayLabel(row.payDate)}</dd>
                </div>
                {row.stockRate !== null && row.stockRate > 0 && (
                  <>
                    <div>
                      <dt>주식 배당률</dt>
                      <dd>{n(row.stockRate, "%")}</dd>
                    </div>
                    <div>
                      <dt>주식 지급일</dt>
                      <dd>{dayLabel(row.stockPayDate)}</dd>
                    </div>
                  </>
                )}
              </dl>
            </article>
          ))}
        </div>
        <p className="financial-note">
          기준일은 매수 마감일이나 배당락일이 아닙니다. 일정·금액은 변경될 수
          있으며, 여기의 배당 정보는 모의 계좌에 자동 입금되지 않습니다.
        </p>
        <Source load={dividends} />
      </section>
      <section aria-label="종목 공시" className="research-separated">
        <h3>최근 공시</h3>
        <p className="financial-basis">
          최근 90일의 공시를 최신순으로 최대 100건 표시합니다. 분류는 공시 제목
          기준입니다.
        </p>
        <Status load={filings} empty="최근 90일에 조회된 공시가 없습니다." />
        {entries.length > 0 && (
          <>
            <div
              className="research-controls"
              role="group"
              aria-label="공시 분류"
            >
              {categories.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            {(filings.result?.data?.total ?? 0) > entries.length && (
              <p className="financial-note">
                전체 {n(filings.result?.data?.total)}건 중 최신 {entries.length}
                건입니다.
              </p>
            )}
            <ul className="research-filings">
              {entries
                .filter(
                  (row) => category === "전체" || row.category === category,
                )
                .map((row) => (
                  <li key={row.id}>
                    <a href={row.url} target="_blank" rel="noopener noreferrer">
                      <small>
                        {dayLabel(row.date)} · {row.category}
                      </small>
                      <span>
                        {row.title}
                        <ExternalLink size={14} />
                      </span>
                    </a>
                  </li>
                ))}
            </ul>
          </>
        )}
        <Source load={filings} />
      </section>
    </>
  );
}

function Forecasts(props: Props) {
  const load = useResearch<Estimates>(
    props.symbol,
    "estimates",
    props.active,
    props.reload,
  );
  const [metric, setMetric] = useState<
    "revenue" | "operatingProfit" | "netIncome"
  >("revenue");
  const data = load.result?.data,
    labels = {
      revenue: "매출액",
      operatingProfit: "영업이익",
      netIncome: "당기순이익",
    };
  const max = Math.max(
    1,
    ...(data?.rows ?? []).map((row) => Math.abs(row[metric] ?? 0)),
  );
  return (
    <section aria-label="추정 실적 분석">
      <h3>실제 실적과 앞으로의 예상</h3>
      <p className="financial-basis">
        KIS가 제공하는 종목 추정 실적입니다. ‘예상’은 미래 실적 추정치이며 실제
        실적이나 시장 전체 컨센서스로 확정할 수 없습니다.
      </p>
      <Status
        load={load}
        empty="제공된 추정 실적이 없습니다. 분석 기관의 전망이 없는 종목일 수 있습니다."
      />
      {data && data.rows.length > 0 && (
        <>
          <p className="financial-basis">
            추정 자료 기준일 {dayLabel(data.asOf)} · 연간 실적 · 금액: 억 원
          </p>
          <div
            className="research-controls"
            role="group"
            aria-label="예상 실적 지표"
          >
            {(["revenue", "operatingProfit", "netIncome"] as const).map(
              (key) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={metric === key}
                  onClick={() => setMetric(key)}
                >
                  {labels[key]}
                </button>
              ),
            )}
          </div>
          <div className="research-estimates">
            {data.rows.map((row) => (
              <article
                key={row.date}
                className={row.estimated ? "estimated" : "actual"}
              >
                <div>
                  <strong>{financialDate(row.date)}</strong>
                  <span className="research-estimate-badge">
                    {row.estimated ? "예상 E" : "실적"}
                  </span>
                </div>
                <p className={(row[metric] ?? 0) < 0 ? "down" : ""}>
                  {labels[metric]} <b>{amount(row[metric])}</b>
                </p>
                <div className="research-estimate-track" aria-hidden="true">
                  <i
                    className={(row[metric] ?? 0) < 0 ? "negative" : ""}
                    style={{
                      width: (Math.abs(row[metric] ?? 0) / max) * 100 + "%",
                    }}
                  />
                </div>
                <dl>
                  {Object.entries(labels)
                    .filter(([key]) => key !== metric)
                    .map(([key, label]) => (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd>{amount(row[key as keyof typeof labels])}</dd>
                      </div>
                    ))}
                </dl>
              </article>
            ))}
          </div>
          <p className="financial-note">
            예상 구간은 미래 실적 추정치이며 시장 전체 컨센서스로 확정할 수
            없습니다. 점선은 예상 구간을 뜻합니다. 막대 길이는 절댓값, 음수는
            파란색과 ‘−’로 표시합니다. 이 API에는 발표 직전 예상치의 이력과 참여
            기관 수가 없어 어닝 서프라이즈·예상치 상향/하향률을 계산하지
            않습니다. 실제 실적 열도 추정 자료의 기준일에 수록된 값이므로 최신
            재무 요약과 다를 수 있습니다.
          </p>
        </>
      )}
      <Source load={load} />
    </section>
  );
}

function DartFinancials(props: Props) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear - 1),
    [report, setReport] = useState<DartReport>("11011"),
    [basis, setBasis] = useState<DartBasis>("CFS"),
    [section, setSection] = useState<DartAccount["section"]>("CF");
  const load = useResearch<DartStatement>(
    props.symbol,
    "dart",
    props.active,
    props.reload,
    `year=${year}&report=${report}&basis=${basis}`,
  );
  const data = load.result?.data,
    accounts =
      data?.accounts.filter((account) => account.section === section) ?? [];
  const value = (
    account: DartAccount,
    key: "current" | "previous" | "cumulative",
  ) =>
    account.currency === "KRW"
      ? n(account[key] === null ? null : account[key]! / 100000000)
      : n(account[key]);
  return (
    <section aria-label="공시 재무제표">
      <h3>공시 원문 기준 재무제표</h3>
      <p className="financial-basis">
        연결·별도 회계 기준과 보고서를 직접 선택해 현금흐름·손익·재무상태를
        확인합니다.
      </p>
      <Status
        load={load}
        empty="선택한 기준의 보고서가 없습니다. 별도 재무제표 또는 다른 사업연도를 선택해보세요."
      />
      {load.result?.status !== "unconfigured" && (
        <>
          <div className="research-dart-controls">
            <label>
              사업연도
              <select
                aria-label="공시 사업연도"
                value={year}
                onChange={(e) => setYear(+e.target.value)}
              >
                {Array.from(
                  { length: thisYear - 2014 },
                  (_, i) => thisYear - i,
                ).map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
            </label>
            <label>
              보고서
              <select
                aria-label="공시 보고서"
                value={report}
                onChange={(e) => setReport(e.target.value as DartReport)}
              >
                {Object.entries(dartReportNames).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              회계 기준
              <select
                aria-label="공시 회계 기준"
                value={basis}
                onChange={(e) => setBasis(e.target.value as DartBasis)}
              >
                <option value="CFS">연결</option>
                <option value="OFS">별도</option>
              </select>
            </label>
          </div>
          {data && data.accounts.length > 0 && (
            <>
              <div className="financial-subheading">
                <h4>
                  {data.year}년 {dartReportNames[data.report]} ·{" "}
                  {data.basis === "CFS" ? "연결" : "별도"}
                </h4>
                {data.receipt && (
                  <a
                    className="research-link"
                    href={
                      "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=" +
                      data.receipt
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    공시 원문 <ExternalLink size={14} />
                  </a>
                )}
              </div>
              <dl className="financial-metrics research-summary">
                {(
                  [
                    ["operating", "영업활동"],
                    ["investing", "투자활동"],
                    ["financing", "재무활동"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <dt>{label} 현금흐름</dt>
                    <dd className={(data.cashflow[key] ?? 0) < 0 ? "down" : ""}>
                      {amount(data.cashflow[key])}
                    </dd>
                    <small>
                      {report === "11011" ? "연간" : "해당 보고 기간 누적"}
                    </small>
                  </div>
                ))}
              </dl>
              <div
                className="research-controls"
                role="group"
                aria-label="공시 재무표 종류"
              >
                {(
                  [
                    ["CF", "현금흐름표"],
                    ["BS", "재무상태표"],
                    ["IS", "손익계산서"],
                    ["CIS", "포괄손익"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={section === key}
                    onClick={() => setSection(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="financial-note">
                KRW는 억 원으로 환산하며 다른 통화는 원본 금액과 통화를
                표시합니다. 분·반기 손익의 ‘당기’는 3개월 금액, 누적액은 별도
                표시합니다. 현금흐름은 보고 기간 누적, 재무상태는 결산 시점
                잔액입니다. 계정이 없거나 표준 계정을 특정할 수 없으면 요약값을
                표시하지 않습니다.
              </p>
              {!accounts.length ? (
                <p className="financial-empty">
                  이 보고서에 선택한 재무표가 없습니다.
                </p>
              ) : (
                <div className="research-dart-accounts">
                  {accounts.map((account, i) => (
                    <article key={account.id + ":" + i}>
                      <h4>
                        {account.name}{" "}
                        <small>
                          {account.currency === "KRW"
                            ? "억 원"
                            : account.currency}
                        </small>
                      </h4>
                      <dl>
                        <div>
                          <dt>
                            당기 <small>{account.currentLabel}</small>
                          </dt>
                          <dd>{value(account, "current")}</dd>
                        </div>
                        <div>
                          <dt>
                            비교 <small>{account.previousLabel}</small>
                          </dt>
                          <dd>{value(account, "previous")}</dd>
                        </div>
                        {account.cumulative !== null && (
                          <div>
                            <dt>당기 누적</dt>
                            <dd>{value(account, "cumulative")}</dd>
                          </div>
                        )}
                      </dl>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
      <Source load={load} />
    </section>
  );
}
