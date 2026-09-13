import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Account, Stock, StockTheme } from "./types";
import type {
  JournalEntry,
  PerformanceReport,
  TradePlan,
  TradeReview,
} from "./learningTypes";
import { portfolioRisk, projectedWeight } from "./portfolioRisk";
import "./account-learning.css";

const money = (n: number) => Math.round(n).toLocaleString("ko-KR");
const percent = (n: number | null) =>
  n === null ? "수집 중" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const time = (n: number | string) =>
  new Date(n).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Study-Client": "web" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "불러오지 못했습니다.");
  return data;
}

export function TradePlanFields({
  plan,
  onChange,
}: {
  plan: TradePlan;
  onChange: (plan: TradePlan) => void;
}) {
  return (
    <details className="trade-plan-fields">
      <summary>
        투자 계획 남기기 <span className="muted">선택</span>
      </summary>
      <p className="learning-caption">
        매매 이유와 함께 주문 시점의 계획으로 보존합니다. 복기는 내 투자
        계좌에서 작성할 수 있습니다.
      </p>
      <label>
        예상 보유 기간
        <input
          aria-label="예상 보유 기간"
          maxLength={100}
          placeholder="예: 다음 분기 실적 발표까지"
          value={plan.horizon}
          onChange={(e) => onChange({ ...plan, horizon: e.target.value })}
        />
      </label>
      <label>
        판단을 바꿀 조건
        <textarea
          aria-label="판단을 바꿀 조건"
          maxLength={1000}
          rows={3}
          placeholder="어떤 사실이 확인되면 매수 근거가 틀렸다고 볼까요?"
          value={plan.invalidation}
          onChange={(e) => onChange({ ...plan, invalidation: e.target.value })}
        />
      </label>
      <label>
        근거 자료
        <input
          aria-label="근거 자료"
          maxLength={1000}
          placeholder="뉴스·공시 제목, 날짜 또는 링크"
          value={plan.source}
          onChange={(e) => onChange({ ...plan, source: e.target.value })}
        />
      </label>
    </details>
  );
}

export function OrderWeightPreview(props: {
  account: Account | null;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  mark: number;
  feeBps: number;
  taxBps: number;
}) {
  if (!props.account) return null;
  const weight = projectedWeight(
    props.account,
    props.symbol,
    props.side,
    props.quantity,
    props.price,
    props.feeBps,
    props.taxBps,
    props.mark,
  );
  if (weight === null) return null;
  return (
    <p className="order-weight-preview">
      전량 체결 가정 시 이 종목 비중 <strong>{weight.toFixed(1)}%</strong>
      <small>
        현재 평가 가격과 예상 주문 가격·비용 기준입니다. 실제 체결 수량·가격에
        따라 달라집니다.
      </small>
    </p>
  );
}

function PerformanceChart({ report }: { report: PerformanceReport }) {
  const [benchmark, setBenchmark] = useState<"kospi" | "kosdaq">("kospi");
  const points = report.points;
  const values = points
    .flatMap((p) => [p.rate, p[benchmark]])
    .filter((v): v is number => v !== null);
  if (points.length < 2 || !values.length)
    return (
      <p className="learning-caption">
        평가 기록이 두 개 이상 쌓이면 수익률 추이를 표시합니다.
      </p>
    );
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values),
    span = Math.max(max - min, 0.5);
  const start = points[0].at,
    duration = Math.max(1, points.at(-1)!.at - start);
  const y = (value: number) => 155 - ((value - min) / span) * 125;
  const paths = (key: "rate" | "kospi" | "kosdaq") => {
    let path = "",
      previous = false;
    for (const p of points) {
      if (p[key] === null) {
        previous = false;
        continue;
      }
      path += `${previous ? " L" : " M"}${50 + ((p.at - start) / duration) * 625},${y(p[key]!)} `;
      previous = true;
    }
    return path;
  };
  return (
    <div className="performance-chart">
      <div className="learning-toolbar">
        <span className="chart-account-key">● 내 계좌</span>
        <label>
          비교 지수
          <select
            value={benchmark}
            onChange={(e) => setBenchmark(e.target.value as typeof benchmark)}
          >
            <option value="kospi">KOSPI</option>
            <option value="kosdaq">KOSDAQ</option>
          </select>
        </label>
      </div>
      <svg
        viewBox="0 0 700 200"
        role="img"
        aria-label={`추가 지급금을 제외한 내 계좌 수익률과 ${benchmark.toUpperCase()} 추이`}
      >
        <line x1="50" x2="675" y1={y(0)} y2={y(0)} className="chart-zero" />
        <text x="4" y="25">
          {max.toFixed(1)}%
        </text>
        <text x="4" y="157">
          {min.toFixed(1)}%
        </text>
        <path d={paths("rate")} className="chart-account" />
        <path d={paths(benchmark)} className="chart-benchmark" />
        <text x="50" y="185">
          {time(start)}
        </text>
        <text x="675" y="185" textAnchor="end">
          {time(points.at(-1)!.at)}
        </text>
      </svg>
      <p className="learning-caption">
        파랑: {benchmark.toUpperCase()} 가격지수 · 같은 관측 시작점 대비 · 배당
        재투자 지수가 아닙니다. 누락된 지수 값은 연결하지 않습니다.
      </p>
    </div>
  );
}

export function PerformancePanel() {
  const [range, setRange] = useState("all"),
    [group, setGroup] = useState("day");
  const [report, setReport] = useState<PerformanceReport | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      running = false;
    setReport(null);
    setError("");
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const data = await request<PerformanceReport>(
          `/performance?range=${range}&group=${group}`,
        );
        if (active) {
          setReport(data);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        running = false;
      }
    };
    void load();
    const timer = setInterval(load, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [range, group]);
  return (
    <section className="panel learning-panel" aria-label="계좌 수익률 기록">
      <div className="panel-heading">
        <h2>계좌 수익률 기록</h2>
        <span className="muted">장중 5분 간격 자동 평가</span>
      </div>
      <div className="learning-body">
        <div className="learning-toolbar">
          <label>
            조회 기간
            <select value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="all">수집 시작부터</option>
              <option value="day">최근 24시간</option>
              <option value="week">최근 7일</option>
              <option value="month">최근 30일</option>
            </select>
          </label>
          <label>
            손익 집계
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="day">일별</option>
              <option value="week">주별</option>
              <option value="month">월별</option>
            </select>
          </label>
        </div>
        {error && <p role="alert">{error}</p>}
        {!report ? (
          <p>평가 기록을 불러오는 중입니다.</p>
        ) : (
          <>
            <div className="learning-metrics">
              <div>
                <small>지급금 보정 수익률</small>
                <strong>{percent(report.rate)}</strong>
              </div>
              <div>
                <small>관측 최대 낙폭</small>
                <strong>{percent(report.maxDrawdown)}</strong>
              </div>
              <div>
                <small>기간 투자손익</small>
                <strong>
                  {report.profit === null
                    ? "수집 중"
                    : money(report.profit) + "원"}
                </strong>
              </div>
              <div>
                <small>같은 관측 기간 KOSPI / KOSDAQ</small>
                <strong className="benchmark-values">
                  {percent(report.kospi)} / {percent(report.kosdaq)}
                </strong>
              </div>
            </div>
            {report.flowGap && (
              <p className="learning-notice">
                지급 전후 평가가 누락된 구간이 있어 수익률·낙폭을 표시하지
                않습니다. 기간을 바꾸면 연속된 기록을 확인할 수 있습니다.
              </p>
            )}
            {report.collectionGap && (
              <p className="learning-notice">
                같은 날 평가 기록에 10분을 넘는 간격이 있습니다. 관측 사이의
                가격 변동은 반영되지 않을 수 있습니다.
              </p>
            )}
            <PerformanceChart report={report} />
            {report.source === "demo" && (
              <p className="learning-caption">
                데모 모드: 비교 지수는 고정된 가상 값입니다.
              </p>
            )}
            <p className="learning-caption">
              {report.startedAt
                ? `${time(report.startedAt)} ~ ${time(report.lastAt!)} (KST) · ${report.count}개 기록 · 추가 지급 ${money(report.netGrants)}원`
                : "자동 평가를 시작하면 기록이 표시됩니다."}
              <br />새 집계 시작 이후의 관측값입니다. 기존 조회 기록은 소급
              복원하지 않습니다. 지급 전후를 분리한 구간 수익률을 연결하며, 최대
              낙폭은 수집된 시점 기준입니다.
            </p>
            {report.periods.length > 0 && (
              <details>
                <summary>기간별 손익 내역</summary>
                <div className="learning-table-wrap">
                  <table>
                    <caption className="sr-only">
                      기간별 투자손익과 추가 지급금
                    </caption>
                    <thead>
                      <tr>
                        <th>기간 (KST)</th>
                        <th>투자손익</th>
                        <th>추가 지급</th>
                        <th>수익률</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.periods.map((p) => (
                        <tr key={p.label}>
                          <td>
                            {p.label}
                            {group === "week" ? " 주" : ""}
                          </td>
                          <td>{money(p.profit)}원</td>
                          <td>{money(p.netGrants)}원</td>
                          <td>{percent(p.rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="learning-caption">
                  각 구간의 마지막 관측 시점을 기준으로 묶습니다. 첫 구간은 수집
                  시작 이후이며 최대 최근 90개 구간을 표시합니다.
                </p>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function JournalCard({
  entry,
  name,
  onSaved,
}: {
  entry: JournalEntry;
  name: string;
  onSaved: () => void;
}) {
  const [review, setReview] = useState<TradeReview>(entry.review),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await request(`/journal/${entry.id}`, {
        revision: entry.revision,
        review,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="journal-card">
      <summary>
        <span>
          <strong>
            {name} · {entry.side === "buy" ? "매수" : "매도"}
          </strong>
          <small>
            {time(entry.created_at)} · #{entry.id} · {entry.filled_quantity}/
            {entry.quantity}주 체결 ·{" "}
            {entry.status === "pending"
              ? "대기"
              : entry.status === "cancelled"
                ? "취소"
                : "체결 완료"}
          </small>
        </span>
        <span className="journal-status">
          {entry.review.adherence === "unreviewed" ? "복기 전" : "복기 완료"}
        </span>
      </summary>
      <div className="journal-content">
        {entry.replaces_id && (
          <p className="learning-caption">
            #{entry.replaces_id} 주문의 정정 주문입니다. 최초 투자 계획을
            이어받았습니다.
          </p>
        )}
        <dl className="journal-plan">
          <dt>주문 당시 매매 이유</dt>
          <dd>{entry.note || "기록하지 않았습니다."}</dd>
          <dt>예상 보유 기간</dt>
          <dd>{entry.plan.horizon || "기록 없음"}</dd>
          <dt>판단을 바꿀 조건</dt>
          <dd>{entry.plan.invalidation || "기록 없음"}</dd>
          <dt>근거 자료</dt>
          <dd>{entry.plan.source || "기록 없음"}</dd>
        </dl>
        <p className="learning-caption">
          {entry.context
            ? `주문 시 수신 호가 (${time(entry.context.capturedAt)}) · 매수 1호가 ${entry.context.bid === null ? "없음" : money(entry.context.bid) + "원"} · 매도 1호가 ${entry.context.ask === null ? "없음" : money(entry.context.ask) + "원"}`
            : "기존 주문에는 당시 호가 기록이 없습니다."}
          {entry.side === "sell" &&
            ` · 이 주문의 실현손익 ${money(entry.realizedPnl)}원`}
        </p>
        <form onSubmit={save} className="journal-form">
          <label>
            계획 준수 여부
            <select
              value={review.adherence}
              onChange={(e) =>
                setReview({
                  ...review,
                  adherence: e.target.value as TradeReview["adherence"],
                })
              }
            >
              <option value="unreviewed">작성 중</option>
              <option value="followed">계획을 지켰어요</option>
              <option value="partial">일부 지켰어요</option>
              <option value="broken">계획과 다르게 행동했어요</option>
            </select>
          </label>
          <label>
            판단 평가·매도 이유
            <textarea
              rows={3}
              maxLength={2000}
              required={review.adherence !== "unreviewed"}
              value={review.reason}
              onChange={(e) => setReview({ ...review, reason: e.target.value })}
              placeholder="당시 근거가 맞았나요? 매도했다면 이유도 남겨주세요."
            />
          </label>
          <label>
            배운 점·다음에 바꿀 점
            <textarea
              rows={3}
              maxLength={2000}
              required={review.adherence !== "unreviewed"}
              value={review.lesson}
              onChange={(e) => setReview({ ...review, lesson: e.target.value })}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button className="primary" disabled={busy}>
            {busy ? "저장 중…" : "복기 저장"}
          </button>
        </form>
      </div>
    </details>
  );
}

export function JournalPanel({ stocks }: { stocks: Stock[] }) {
  const [page, setPage] = useState(0),
    [symbol, setSymbol] = useState(""),
    [draft, setDraft] = useState(""),
    [filter, setFilter] = useState("all"),
    [reload, setReload] = useState(0);
  const [data, setData] = useState<{
      entries: JournalEntry[];
      total: number;
    } | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    setData(null);
    request<{ entries: JournalEntry[]; total: number }>(
      `/journal?page=${page}&symbol=${encodeURIComponent(symbol)}&filter=${filter}`,
    )
      .then((result) => {
        if (active) {
          if (page > 0 && result.total <= page * 20) setPage(page - 1);
          else setData(result);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [page, symbol, filter, reload]);
  return (
    <section className="panel learning-panel" aria-label="투자 일지">
      <div className="panel-heading">
        <h2>투자 일지</h2>
        <span className="muted">계획을 남기고 판단을 돌아보세요</span>
      </div>
      <div className="learning-body">
        <div className="learning-toolbar">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSymbol(draft.trim().toUpperCase());
              setPage(0);
            }}
          >
            <label>
              일지 종목코드
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="전체 또는 005930"
                pattern="[A-Za-z0-9]{6}|"
                maxLength={6}
              />
            </label>
            <button>검색</button>
          </form>
          <label>
            복기 상태
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">전체 주문</option>
              <option value="unreviewed">복기 전</option>
              <option value="reviewed">복기 완료</option>
            </select>
          </label>
          <button onClick={() => setReload((r) => r + 1)}>일지 새로고침</button>
        </div>
        <p className="learning-caption">
          최초 계획은 주문 당시 기록으로 보존됩니다. 복기는 수정할 수 있으며,
          기존 주문과 미체결·취소 주문도 돌아볼 수 있습니다.
        </p>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {!data && !error ? (
          <p>일지를 불러오는 중입니다.</p>
        ) : (
          data && (
            <>
              {!data.entries.length && (
                <p className="learning-empty">
                  조건에 맞는 주문이 없습니다. 주문할 때 매매 이유와 투자 계획을
                  남겨보세요.
                </p>
              )}
              {data.entries.map((entry) => (
                <JournalCard
                  key={`${entry.id}-${entry.revision}`}
                  entry={entry}
                  name={
                    stocks.find((s) => s.symbol === entry.symbol)?.name ??
                    entry.symbol
                  }
                  onSaved={() => {
                    setNotice("복기를 저장했습니다.");
                    setReload((r) => r + 1);
                  }}
                />
              ))}
              <div className="journal-pagination">
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  이전 일지
                </button>
                <span>
                  {page + 1} / {Math.max(1, Math.ceil(data.total / 20))} · 전체{" "}
                  {data.total}건
                </span>
                <button
                  disabled={(page + 1) * 20 >= data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  다음 일지
                </button>
              </div>
            </>
          )
        )}
      </div>
    </section>
  );
}

export function PortfolioRiskPanel({
  account,
  stocks,
  themes,
  themesAvailable,
}: {
  account: Account | null;
  stocks: Stock[];
  themes: StockTheme[];
  themesAvailable: boolean;
}) {
  const risk = useMemo(
    () => (account ? portfolioRisk(account, stocks, themes) : null),
    [account, stocks, themes],
  );
  const [shock, setShock] = useState(10),
    [target, setTarget] = useState("ALL");
  if (!risk) return null;
  const effectiveTarget =
    risk.complete && risk.positions.some((p) => p.symbol === target)
      ? target
      : "ALL";
  const targets = risk.complete
    ? risk.positions.filter(
        (p) => effectiveTarget === "ALL" || p.symbol === effectiveTarget,
      )
    : [];
  const loss = targets.reduce((sum, p) => sum + (p.value * shock) / 100, 0);
  return (
    <section className="panel learning-panel" aria-label="포트폴리오 위험 분석">
      <div className="panel-heading">
        <h2>포트폴리오 위험 분석</h2>
        <span className="muted">현재 평가액 기준</span>
      </div>
      <div className="learning-body">
        {!risk.complete ? (
          <p className="learning-notice">
            {risk.missing.join(", ")}의 시세가 없어 비중과 위험을 계산할 수
            없습니다.
          </p>
        ) : (
          <>
            <div className="learning-metrics">
              <div>
                <small>현금 비중</small>
                <strong>{risk.cashWeight.toFixed(1)}%</strong>
              </div>
              <div>
                <small>최대 종목 비중</small>
                <strong>{(risk.positions[0]?.weight ?? 0).toFixed(1)}%</strong>
                <small>{risk.positions[0]?.name ?? "보유 종목 없음"}</small>
              </div>
              <div>
                <small>상위 3종목 비중</small>
                <strong>
                  {risk.positions
                    .slice(0, 3)
                    .reduce((s, p) => s + p.weight, 0)
                    .toFixed(1)}
                  %
                </strong>
              </div>
            </div>
            {!risk.positions.length ? (
              <p className="learning-empty">
                주식을 보유하면 종목 비중과 테마 중복을 확인할 수 있습니다.
              </p>
            ) : (
              <>
                <div className="risk-columns">
                  <div>
                    <h3>종목별 비중·평가손익</h3>
                    {risk.positions.map((p) => (
                      <div className="risk-position" key={p.symbol}>
                        <div>
                          <span>{p.name}</span>
                          <strong>{p.weight.toFixed(1)}%</strong>
                        </div>
                        <progress
                          value={p.weight}
                          max={100}
                          aria-label={`${p.name} 계좌 비중`}
                        />
                        <small>
                          {money(p.value)}원 · 평가손익 {money(p.pnl)}원
                        </small>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h3>업종별 비중</h3>
                    {risk.industries.map((p) => (
                      <div className="risk-pair" key={p.name}>
                        <span>{p.name}</span>
                        <strong>{p.weight.toFixed(1)}%</strong>
                      </div>
                    ))}
                    <p className="learning-caption">
                      ETF는 구성 자산을 분해하지 않아 개별 종목과의 중복 노출이
                      포함되지 않습니다. 업종 정보가 없는 종목은 미분류로
                      표시합니다. 아래 테마 분류와는 별개입니다.
                    </p>
                    <h3>보유 종목의 테마 노출</h3>
                    {!themesAvailable ? (
                      <p className="learning-caption">
                        테마 정보를 불러오지 못했습니다.
                      </p>
                    ) : !risk.exposures.length ? (
                      <p className="learning-caption">
                        연결된 테마 정보가 없습니다.
                      </p>
                    ) : (
                      <>
                        {risk.exposures.slice(0, 3).map((t) => (
                          <div className="risk-theme" key={t.code}>
                            <div className="risk-pair">
                              <span>{t.name}</span>
                              <strong>{t.weight.toFixed(1)}%</strong>
                            </div>
                            <small>{t.members.join(" · ")}</small>
                          </div>
                        ))}
                        {risk.exposures.length > 3 && (
                          <details>
                            <summary>
                              나머지 {risk.exposures.length - 3}개 테마 보기
                            </summary>
                            {risk.exposures.slice(3).map((t) => (
                              <div className="risk-theme" key={t.code}>
                                <div className="risk-pair">
                                  <span>{t.name}</span>
                                  <strong>{t.weight.toFixed(1)}%</strong>
                                </div>
                                <small>{t.members.join(" · ")}</small>
                              </div>
                            ))}
                          </details>
                        )}
                      </>
                    )}
                    <p className="learning-caption">
                      한 종목은 여러 테마에 포함될 수 있습니다. 테마 비중끼리
                      합산하지 않으며, 테마가 같다고 가격이 항상 함께 움직이는
                      것은 아닙니다.
                    </p>
                  </div>
                </div>
                <div className="risk-scenario">
                  <h3>가격 하락 시나리오</h3>
                  <div className="learning-toolbar">
                    <label>
                      하락 대상
                      <select
                        value={
                          risk.positions.some((p) => p.symbol === target)
                            ? target
                            : "ALL"
                        }
                        onChange={(e) => setTarget(e.target.value)}
                      >
                        <option value="ALL">보유 주식 전체</option>
                        {risk.positions.map((p) => (
                          <option key={p.symbol} value={p.symbol}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      가정 하락률
                      <select
                        value={shock}
                        onChange={(e) => setShock(Number(e.target.value))}
                      >
                        {[5, 10, 20, 30].map((n) => (
                          <option key={n} value={n}>
                            {n}% 하락
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <p>
                    계좌 평가액 <strong>{money(loss)}원 감소</strong> · 계좌
                    전체 대비{" "}
                    <strong>
                      {risk.total
                        ? ((loss / risk.total) * 100).toFixed(2)
                        : "0.00"}
                      %
                    </strong>
                  </p>
                  <p className="learning-caption">
                    선택한 주식 가격만 동시에 하락하고 현금과 나머지 종목은
                    그대로인 가상 계산입니다. 매도·비용·상관관계는 반영하지
                    않으며 손실 예측이 아닙니다.
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
