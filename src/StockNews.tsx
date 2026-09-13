import {
  classifyNews,
  groupNews,
  NEWS_CATEGORIES,
  newsDay,
  type NewsCategory,
} from "./newsAnalysis";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Newspaper, RefreshCw } from "lucide-react";
import {
  NEWS_SOURCES,
  type NewsSource,
  type StockNewsResponse,
  type StockNewsArticle,
} from "./newsTypes";
import "./stock-news.css";
const time = (value: string) =>
  new Date(value).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export default function StockNews({
  symbol,
  name,
  active,
  onData,
  onChart,
  chartDate,
  onClearDate,
}: {
  symbol: string;
  name: string;
  active: boolean;
  onData?: (data: StockNewsResponse) => void;
  onChart?: (article: StockNewsArticle) => void;
  chartDate?: string | null;
  onClearDate?: () => void;
}) {
  const [data, setData] = useState<StockNewsResponse | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [reload, setReload] = useState(0),
    [limit, setLimit] = useState(6);
  const [source, setSource] = useState<NewsSource | "전체">("전체");
  const [category, setCategory] = useState<NewsCategory | "all">("all");
  const [mode, setMode] = useState<"issues" | "latest">("issues");
  const articles = useMemo(
    () =>
      (data?.articles ?? []).filter(
        (article) =>
          (source === "전체" || article.source === source) &&
          (category === "all" ||
            classifyNews(article.title).some(
              (tag) => tag.category === category,
            )) &&
          (!chartDate || newsDay(article.publishedAt) === chartDate),
      ),
    [data, source, category, chartDate],
  );
  const groups = useMemo(() => groupNews(articles, name), [articles, name]);
  const displayed =
    mode === "issues"
      ? groups
      : articles.map((article) => ({
          id: article.url,
          lead: article,
          articles: [article],
          tags: classifyNews(article.title),
        }));
  useEffect(() => setLimit(6), [chartDate, category, mode]);
  useEffect(() => {
    if (data) onData?.(data);
  }, [data, onData]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch("/api/stock-news?symbol=" + encodeURIComponent(symbol), {
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw Error(value.error || "뉴스 조회 실패");
        if (value.symbol !== symbol)
          throw Error("선택 종목의 뉴스를 다시 조회해 주세요.");
        return value as StockNewsResponse;
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
  }, [symbol, active, reload]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setReload((v) => v + 1), 300000);
    return () => clearInterval(timer);
  }, [active]);
  return (
    <>
      <div className="panel-heading stock-news-heading">
        <div>
          <h2>
            <Newspaper size={18} />
            {name} 관련 뉴스
          </h2>
          <small>
            {NEWS_SOURCES.length}개 언론사 · 제목에 종목명 또는 코드가 언급된
            기사
          </small>
        </div>
        <button
          className="news-refresh"
          type="button"
          disabled={loading}
          onClick={() => setReload((v) => v + 1)}
          aria-label="관련 뉴스 새로고침"
        >
          <RefreshCw size={15} />
          {loading ? "조회 중" : "새로고침"}
        </button>
      </div>
      {data && (
        <div
          className="news-source-filters"
          role="group"
          aria-label="뉴스 언론사 선택"
        >
          {(["전체", ...NEWS_SOURCES] as const).map((name) => (
            <button
              type="button"
              key={name}
              aria-pressed={source === name}
              onClick={() => {
                setSource(name);
                setLimit(6);
              }}
            >
              {name}{" "}
              <span>
                {name === "전체"
                  ? data.articles.length
                  : data.articles.filter((article) => article.source === name)
                      .length}
              </span>
            </button>
          ))}
        </div>
      )}
      {data && (
        <label className="news-source-select">
          언론사
          <select
            aria-label="뉴스 언론사"
            value={source}
            onChange={(event) => {
              setSource(event.target.value as NewsSource | "전체");
              setLimit(6);
            }}
          >
            {(["전체", ...NEWS_SOURCES] as const).map((name) => (
              <option key={name} value={name}>
                {name} (
                {name === "전체"
                  ? data.articles.length
                  : data.articles.filter((article) => article.source === name)
                      .length}
                )
              </option>
            ))}
          </select>
        </label>
      )}
      {data && (
        <div className="news-analysis-controls">
          <label>
            뉴스 유형
            <select
              aria-label="뉴스 유형"
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as typeof category)
              }
            >
              <option value="all">전체 유형</option>
              {Object.entries(NEWS_CATEGORIES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div role="group" aria-label="뉴스 묶음 방식">
            <button
              type="button"
              aria-pressed={mode === "issues"}
              onClick={() => setMode("issues")}
            >
              이슈별
            </button>
            <button
              type="button"
              aria-pressed={mode === "latest"}
              onClick={() => setMode("latest")}
            >
              최신순
            </button>
          </div>
          <p>
            {articles.length}건 · {groups.length}묶음{" "}
            <span>제목 표현으로 자동 분류하며 유사 기사만 묶습니다.</span>
          </p>
        </div>
      )}
      {chartDate && (
        <div className="news-date-filter">
          차트 선택일 {chartDate} (KST)
          <button type="button" onClick={onClearDate}>
            날짜 조건 해제
          </button>
        </div>
      )}
      {error && (
        <p className="analysis-notice" role="alert">
          {error}
          {data && " 마지막 조회 결과를 표시합니다."}
        </p>
      )}
      {loading && !data && (
        <p className="empty" role="status">
          관련 뉴스를 불러오고 있습니다…
        </p>
      )}
      {data?.stale && (
        <p className="analysis-notice" role="status">
          {data.unavailableFeeds.join("·")} 피드 조회가 지연되었습니다. 수집
          시각을 확인해 주세요.
        </p>
      )}
      {data && !articles.length && (
        <p className="empty">
          {category !== "all" || chartDate ? (
            "선택한 유형·날짜에 맞는 기사가 없습니다."
          ) : (
            <>
              {source === "전체"
                ? "현재 제공된 최근 뉴스 제목에서"
                : source + "의 최근 뉴스 제목에서"}{" "}
              {name} 관련 기사를 찾지 못했습니다.
            </>
          )}
        </p>
      )}
      {data && articles.length > 0 && (
        <ul className="stock-news-list">
          {displayed.slice(0, limit).map((issue) => (
            <li key={issue.id}>
              <div className="news-type-tags">
                {issue.tags.map((tag) => (
                  <span
                    key={tag.category}
                    title={
                      tag.evidence
                        ? `제목의 ‘${tag.evidence}’ 표현 기준`
                        : "제목에서 유형을 확인하지 못했습니다."
                    }
                  >
                    {NEWS_CATEGORIES[tag.category]}
                  </span>
                ))}
              </div>
              <a
                href={issue.lead.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{issue.lead.title}</span>
                <ExternalLink size={15} aria-label="새 창으로 원문 보기" />
              </a>
              <div className="news-article-meta">
                <span>{issue.lead.source}</span>
                <time dateTime={issue.lead.publishedAt}>
                  {time(issue.lead.publishedAt)} (KST)
                </time>
              </div>
              {onChart && (
                <button
                  type="button"
                  className="news-chart-button"
                  aria-label={"차트에서 보기: " + issue.lead.title}
                  onClick={() => onChart(issue.lead)}
                >
                  발행일 차트 보기
                </button>
              )}
              {issue.articles.length > 1 && (
                <details className="news-related">
                  <summary>
                    유사 기사 {issue.articles.length}건 ·{" "}
                    {new Set(issue.articles.map((a) => a.source)).size}개 언론사
                  </summary>
                  <p>
                    제목 유사도 기준의 묶음입니다. 원문에서 같은 사건인지 확인할
                    수 있습니다.
                  </p>
                  {issue.articles.slice(1).map((article) => (
                    <article key={article.url}>
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {article.title}
                        <ExternalLink size={13} />
                      </a>
                      <small>
                        {article.source} · {time(article.publishedAt)} (KST)
                      </small>
                      {onChart && (
                        <button
                          type="button"
                          className="news-chart-button"
                          onClick={() => onChart(article)}
                        >
                          이 기사 발행일 차트 보기
                        </button>
                      )}
                    </article>
                  ))}
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && displayed.length > limit && (
        <button
          className="news-more"
          type="button"
          onClick={() => setLimit((v) => v + 6)}
        >
          뉴스 더 보기 ({Math.min(limit, displayed.length)} / {displayed.length}
          )
        </button>
      )}
      <p className="stock-news-footer">
        {data && `수집 ${time(data.updatedAt)} (KST) · `}증권·기업·경제 RSS의
        최근 목록에서 찾습니다. 모든 과거 기사나 본문 검색 결과는 아니며, 짧은
        종목명은 증권 관련 표현도 함께 확인합니다. 언론사별 최대 20건을 표시하며
        기사를 누르면 해당 언론사 원문으로 이동합니다. 유형 분류와 기사 묶음은
        제목 기준이며 투자 판단이나 주가 변동 원인을 확정하지 않습니다.
      </p>
    </>
  );
}
