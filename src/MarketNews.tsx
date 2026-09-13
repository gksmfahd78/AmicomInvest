import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { MarketAnalysisReport } from "./marketAnalysisTypes";
import type { StockThemeCatalog } from "./types";
import type { StockNewsArticle, StockNewsResponse } from "./newsTypes";
import {
  NEWS_CATEGORIES,
  groupNews,
  classifyNews,
  type NewsCategory,
} from "./newsAnalysis";
import {
  briefingArticles,
  briefingCandidates,
  type BriefingMode,
} from "./marketNews";
import { indexStockThemes } from "./stockFilters";
import "./market-news.css";
type Result = { data?: StockNewsResponse; error?: string };
const at = (value: string) =>
  new Date(value).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export default function MarketNews({
  report,
  themes,
  availableSymbols,
  onSelect,
  onNewsSelect,
  active,
}: {
  active: boolean;
  report: MarketAnalysisReport;
  themes: StockThemeCatalog | null;
  availableSymbols: Set<string>;
  onSelect: (symbol: string) => void;
  onNewsSelect: (symbol: string, article: StockNewsArticle) => void;
}) {
  const [mode, setMode] = useState<BriefingMode>("turnover");
  const [category, setCategory] = useState<NewsCategory | "all">("all");
  const [issueLimit, setIssueLimit] = useState(3);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{
    key: string;
    results: Record<string, Result>;
    loading: boolean;
  }>({ key: "", results: {}, loading: false });
  const candidates = briefingCandidates(report, mode, availableSymbols);
  const symbols = candidates
    .map((row) => row.symbol)
    .sort()
    .join(",");
  const key = report.market + ":" + report.date + ":" + symbols;
  const themeIndex = useMemo(
    () => indexStockThemes(themes?.themes ?? []),
    [themes],
  );
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setState((old) => ({
      key,
      results: old.key === key ? old.results : {},
      loading: !!symbols,
    }));
    const queue = symbols ? symbols.split(",") : [];
    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const symbol = queue.shift()!;
        let result: Result;
        try {
          const response = await fetch(
            "/api/stock-news?symbol=" + encodeURIComponent(symbol),
            { signal: controller.signal },
          );
          const data = await response.json();
          if (!response.ok) throw Error(data.error || "뉴스 조회 실패");
          if (data.symbol !== symbol)
            throw Error("종목 뉴스 응답이 일치하지 않습니다.");
          result = { data };
        } catch (error) {
          result = {
            error: error instanceof Error ? error.message : "뉴스 조회 실패",
          };
        }
        if (!controller.signal.aborted)
          setState((old) =>
            old.key !== key
              ? old
              : {
                  ...old,
                  results: {
                    ...old.results,
                    [symbol]: result.error
                      ? { ...old.results[symbol], error: result.error }
                      : result,
                  },
                },
          );
      }
    };
    void Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, worker),
    ).then(() => {
      if (!controller.signal.aborted)
        setState((old) => (old.key === key ? { ...old, loading: false } : old));
    });
    return () => controller.abort();
  }, [key, symbols, reload, active]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setReload((v) => v + 1), 300000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(
    () => setIssueLimit(3),
    [mode, category, report.market, report.date],
  );
  const results = state.key === key ? state.results : {};
  const loading = state.key !== key || state.loading;
  const entries = candidates.map((row) => ({
    row,
    result: results[row.symbol],
    articles: briefingArticles(
      results[row.symbol]?.data,
      report.date,
      category,
    ),
  }));
  const issues = entries
    .flatMap((entry) =>
      groupNews(entry.articles, entry.row.name).map((issue) => ({
        ...entry,
        issue,
      })),
    )
    .sort(
      (a, b) =>
        Date.parse(b.issue.lead.publishedAt) -
        Date.parse(a.issue.lead.publishedAt),
    );
  const seen = new Set<string>();
  const uniqueIssues = issues
    .flatMap((entry) => {
      const articles = entry.issue.articles.filter(
        (article) => !seen.has(article.url),
      );
      if (!articles.length) return [];
      articles.forEach((article) => seen.add(article.url));
      return [
        {
          ...entry,
          issue: {
            ...entry.issue,
            id: articles[0].url,
            lead: articles[0],
            articles,
            tags: classifyNews(articles[0].title),
          },
        },
      ];
    })
    .sort(
      (a, b) =>
        Date.parse(b.issue.lead.publishedAt) -
        Date.parse(a.issue.lead.publishedAt),
    );
  const noNews = entries.filter((entry) => !entry.articles.length);
  const unique = new Set(
    entries.flatMap((entry) => entry.articles.map((article) => article.url)),
  );
  const covered = entries.filter((entry) => entry.articles.length > 0).length;
  const failed = entries.filter(
    (entry) => entry.result?.error || entry.result?.data?.stale,
  ).length;
  return (
    <section
      className="panel market-news"
      id="analysis-news"
      aria-label="시장 이슈 브리핑"
      hidden={!active}
    >
      <div className="insight-heading">
        <div>
          <h2>시장 이슈 브리핑</h2>
          <p>{report.date} 발행 기사 · 최신 이슈순</p>
        </div>
        <button
          type="button"
          className="news-refresh"
          aria-label="브리핑 새로고침"
          disabled={loading}
          onClick={() => setReload((v) => v + 1)}
        >
          <RefreshCw size={16} />
          <span>{loading ? "조회 중…" : "브리핑 새로고침"}</span>
        </button>
      </div>
      <div className="market-news-controls">
        <label>
          비교 대상
          <select
            aria-label="브리핑 비교 대상"
            value={mode}
            onChange={(e) => setMode(e.target.value as BriefingMode)}
          >
            <option value="turnover">거래대금 상위</option>
            <option value="gainers">상승률 상위</option>
            <option value="upper">최근 수집 때 상한가</option>
            <option value="lower">최근 수집 때 하한가</option>
          </select>
        </label>
        <label>
          뉴스 유형
          <select
            aria-label="브리핑 뉴스 유형"
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
          >
            <option value="all">전체 유형</option>
            {Object.entries(NEWS_CATEGORIES).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="market-news-summary" aria-live="polite">
        {candidates.length}종목 비교 · 뉴스 확인 {covered}종목 · 원문{" "}
        {unique.size}건{loading && " · 수집 중"}
        {failed > 0 && ` · ${failed}종목 수집 지연`}
      </p>
      {!candidates.length && (
        <p className="empty">
          {mode === "lower"
            ? "현재 수집된 표본에서 하한가 상태로 확인된 지원 종목이 없습니다. 장중 포착 이력은 종목 순위의 ‘하한가 포착’에서 확인할 수 있습니다."
            : "이 조건에 해당하는 분석 가능 종목이 없습니다."}
        </p>
      )}
      {!!candidates.length && !uniqueIssues.length && (
        <p className="empty">
          {loading
            ? "뉴스를 확인하고 있습니다…"
            : "선택한 날짜·유형에 맞는 뉴스가 없습니다. 다른 유형을 선택하거나 조회 날짜를 확인해 주세요."}
        </p>
      )}
      <div className="market-news-grid">
        {uniqueIssues.slice(0, issueLimit).map(({ row, result, issue }) => {
          const renderIssue = (issue: ReturnType<typeof groupNews>[number]) => (
            <article className="market-news-issue" key={issue.id}>
              <div className="market-news-tags">
                {issue.tags.map((tag) => (
                  <span key={tag.category}>
                    {NEWS_CATEGORIES[tag.category]}
                  </span>
                ))}
              </div>
              <a
                href={issue.lead.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {issue.lead.title} ↗
              </a>
              <small>
                {issue.lead.source} · {at(issue.lead.publishedAt)} (KST)
                {issue.articles.length > 1 &&
                  ` · 유사 기사 ${issue.articles.length}건`}
              </small>
              <button
                type="button"
                onClick={() => onNewsSelect(row.symbol, issue.lead)}
              >
                발행일 차트 · {row.name}
              </button>
              {issue.articles.length > 1 && (
                <details>
                  <summary>다른 언론사 기사 보기</summary>
                  {issue.articles.slice(1).map((article) => (
                    <a
                      className="market-news-related"
                      key={article.url}
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {article.title}
                      <small>
                        {article.source} · {at(article.publishedAt)} (KST)
                      </small>
                    </a>
                  ))}
                </details>
              )}
            </article>
          );
          return (
            <article className="market-news-stock" key={issue.lead.url}>
              <div className="market-news-stock-heading">
                <button type="button" onClick={() => onSelect(row.symbol)}>
                  {row.name} <span>차트 열기 ↗</span>
                </button>
                <b
                  className={
                    row.changeRate > 0
                      ? "up"
                      : row.changeRate < 0
                        ? "down"
                        : "muted"
                  }
                >
                  {row.changeRate > 0 ? "+" : ""}
                  {row.changeRate.toFixed(2)}%
                </b>
              </div>
              {result?.error && (
                <p className="market-news-status" role="status">
                  {result.error}
                  {result.data
                    ? " 마지막 수집 결과입니다."
                    : " 잠시 후 새로고침해 주세요."}
                </p>
              )}
              {result?.data?.stale && (
                <p className="market-news-status">
                  일부 피드 지연 · {result.data.unavailableFeeds.join(" · ")}
                </p>
              )}
              {renderIssue(issue)}
              <details className="news-price-context">
                <summary>종목·시세 기준</summary>
                <p className="market-news-stock-meta">
                  {row.market} · {row.symbol} · 표본 거래대금{" "}
                  {row.turnover === null
                    ? "—"
                    : (row.turnover / 1e8).toLocaleString("ko-KR", {
                        maximumFractionDigits: 1,
                      }) + "억"}
                  <br />
                  분석 수집 {at(report.collectedAt)} (KST)
                </p>
                <p className="market-news-themes">
                  {(themeIndex.get(row.symbol) ?? [])
                    .slice(0, 3)
                    .map((theme) => theme.name)
                    .join(" · ") || "연결된 테마 없음"}
                </p>
              </details>
            </article>
          );
        })}
      </div>
      {uniqueIssues.length > issueLimit && (
        <button
          className="news-load-more"
          onClick={() => setIssueLimit((v) => v + 3)}
        >
          이슈 3개 더 보기 ({issueLimit} / {uniqueIssues.length})
        </button>
      )}
      <details className="analysis-method">
        <summary>뉴스 조회 기준</summary>
        <p className="market-news-note">
          정상 수집된 순위 표본 중 최대 8종목에서 확인한 이슈를 최신 기사순으로
          3개씩 표시합니다. 같은 원문은 한 번만 표시합니다. 현재 RSS 목록에서
          선택한 거래일(KST)의 기사를 찾으며 과거 뉴스 전체 기록은 아닙니다.
          뉴스와 주가를 함께 보여 주며 상승 원인을 단정하지 않습니다. 유형과
          묶음은 제목 표현 기준입니다.
        </p>
      </details>
      {!!noNews.length && (
        <details className="market-news-coverage" open={failed > 0}>
          <summary>
            뉴스 확인 현황 · 기사 없는 종목 {noNews.length}개
            {failed > 0 && ` · 조회 지연 ${failed}개`}
          </summary>
          <ul>
            {noNews.map(({ row, result }) => (
              <li key={row.symbol}>
                <button type="button" onClick={() => onSelect(row.symbol)}>
                  {row.name}
                </button>
                <span>
                  {result?.error ||
                    (result?.data?.stale
                      ? "뉴스 수집 지연"
                      : !result
                        ? "조회 중…"
                        : "선택한 날짜·유형의 기사 없음")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
