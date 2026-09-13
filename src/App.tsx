import {
  readWorkspaceLocation,
  type AnalysisView,
} from "./workspaceNavigation";
import { useWorkspaceHistory } from "./useWorkspaceHistory";
import { useOrderDock } from "./useOrderDock";
import {
  availableSellQuantity,
  quantityAtRatio,
  MAX_ORDER_QUANTITY,
  type QuantityRatio,
} from "./orderQuantity";
import { WorkspaceTabs } from "./WorkspaceTabs";
import EtfDetails from "./EtfDetails";
import { TradingStateNotice, FillEvidence } from "./ExecutionDetails";
import { clockState, bookState, type ExecutionState } from "./executionRules";
import {
  PerformancePanel,
  JournalPanel,
  PortfolioRiskPanel,
  TradePlanFields,
  OrderWeightPreview,
} from "./AccountLearning";
import { emptyPlan, type TradePlan } from "./learningTypes";
import "./investment-education.css";
import type { StockNewsArticle, StockNewsResponse } from "./newsTypes";
import StockNews from "./StockNews";
import StockFinancials from "./StockFinancials";
import {
  indexStockThemes,
  matchesStockSearch,
  matchesStockTheme,
} from "./stockFilters";
import { useMobile } from "./useMobile";
import { tickSize } from "./tradingRules";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  useId,
  type FormEvent,
} from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  TrendingUp,
  ChevronRight,
  Clock3,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Search,
  ShieldCheck,
  MoreHorizontal,
  Star,
  Trophy,
  Wallet,
  X,
  Plus,
  RefreshCw,
} from "lucide-react";
import MarketAnalysis from "./MarketAnalysis";
import Chart from "./Chart";
import AdvancedChart from "./AdvancedChart";
import type { ChartWindow } from "./chartViewport";
import "./advanced-chart.css";
import BrandLogo from "./BrandLogo";
import type {
  User,
  Stock,
  Quote,
  Candle,
  Book,
  Account,
  Member,
  Grant,
  CorporateAction,
  InvestmentAnalytics,
  MarketStatus,
  TradingCosts,
  Competition,
  CompetitionRanking,
  AdminSummary,
  StockTheme,
  StockThemeCatalog,
} from "./types";
const InvestmentEducation = lazy(() => import("./InvestmentEducation"));
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const compactMoney = (n: number) =>
  Math.abs(n) >= 1e8
    ? (n / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + "억원"
    : Math.abs(n) >= 1e4
      ? (n / 1e4).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "만원"
      : won(n) + "원";
const pct = (n: number) =>
  Number.isFinite(n) ? (n > 0 ? "+" : "") + n.toFixed(2) + "%" : "—";
const date = (s: string) =>
  new Date(s).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Study-Client": "web" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "요청에 실패했습니다.");
  return data;
}
function StockLogo({
  symbol,
  name,
  size = "md",
  className = "",
}: {
  symbol: string;
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [symbol]);
  const src =
    "https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock" +
    encodeURIComponent(symbol) +
    ".svg";
  return (
    <span
      className={
        "company-logo company-logo-" +
        size +
        (failed ? " fallback" : "") +
        (className ? " " + className : "")
      }
      aria-hidden="true"
    >
      {failed ? (
        name.trim().slice(0, 1).toUpperCase() || symbol.slice(0, 1)
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
type Detail = {
  chartPeriod?: string;
  quote: Quote;
  candles: Candle[];
  book: Book;
  execution?: ExecutionState;
};
type RankingData = {
  competition: Competition | null;
  competitions: Competition[];
  members: CompetitionRanking[];
};
export default function App() {
  const initialLocation = useRef(readWorkspaceLocation(location.href)).current;
  const [analysisView, setAnalysisView] = useState<AnalysisView>(
    initialLocation.analysis,
  );
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [provider, setProvider] = useState("demo"),
    [tradingCosts, setTradingCosts] = useState<TradingCosts>({
      commissionBps: 0,
      sellTaxBps: 0,
    });
  const isMobile = useMobile();
  const [accountTab, setAccountTab] = useState(initialLocation.accountTab);
  const [mobileTradeTab, setMobileTradeTab] = useState<
    "chart" | "book" | "order" | "financials" | "news"
  >(initialLocation.tradeTab);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenu = useRef<HTMLDialogElement>(null);
  const [stockPickerOpen, setStockPickerOpen] = useState(false);
  const stockPicker = useRef<HTMLDialogElement>(null);
  const tradeWorkspace = useRef<HTMLDivElement>(null);
  const [newsData, setNewsData] = useState<StockNewsResponse | null>(null);
  const [newsFocus, setNewsFocus] = useState<{
    symbol: string;
    article: StockNewsArticle;
  } | null>(null);
  const [newsDateFilter, setNewsDateFilter] = useState<{
    symbol: string;
    day: string;
  } | null>(null);
  const [feedStatus, setFeedStatus] = useState("연결 중");
  const [chartExpanded, setChartExpanded] = useState(false);
  const [chartView, setChartView] = useState<{
    id: string;
    userId: number;
    symbol: string;
    period: string;
    window: ChartWindow;
  } | null>(null);
  const [requestedPage, setPage] = useState(initialLocation.page),
    [stocks, setStocks] = useState<Stock[]>([]),
    [quotes, setQuotes] = useState<Quote[]>([]),
    [account, setAccount] = useState<Account | null>(null),
    [symbol, setSymbol] = useState(initialLocation.symbol),
    [period, setPeriod] = useState(initialLocation.period),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailError, setDetailError] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [search, setSearch] = useState(initialLocation.search),
    [onlyStars, setOnlyStars] = useState(initialLocation.onlyStars),
    [stars, setStars] = useState<string[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [adminSummary, setAdminSummary] = useState<AdminSummary | null>(null),
    [grants, setGrants] = useState<Grant[]>([]),
    [corporateActions, setCorporateActions] = useState<CorporateAction[]>([]),
    [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null),
    [analytics, setAnalytics] = useState<InvestmentAnalytics | null>(null),
    [ranking, setRanking] = useState<CompetitionRanking[]>([]),
    [competition, setCompetition] = useState<Competition | null>(null),
    [competitions, setCompetitions] = useState<Competition[]>([]);
  const page =
    (requestedPage === "education" || requestedPage === "admin") &&
    user?.role !== "admin"
      ? "trade"
      : requestedPage;
  const [side, setSide] = useState<"buy" | "sell">("buy"),
    [orderType, setOrderType] = useState<"market" | "limit">("market"),
    [quantity, setQuantity] = useState("1"),
    [quantityRatio, setQuantityRatio] = useState<QuantityRatio | null>(null),
    [limit, setLimit] = useState(""),
    [note, setNote] = useState(""),
    [tradePlan, setTradePlan] = useState<TradePlan>({ ...emptyPlan }),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("holdings"),
    [grantUser, setGrantUser] = useState(""),
    [grantAmount, setGrantAmount] = useState("10000000"),
    [grantNote, setGrantNote] = useState("스터디 시작 투자금"),
    [actionSymbol, setActionSymbol] = useState("005930"),
    [actionType, setActionType] = useState<"dividend" | "split">("dividend"),
    [actionAmount, setActionAmount] = useState("0"),
    [actionNumerator, setActionNumerator] = useState("2"),
    [actionDenominator, setActionDenominator] = useState("1"),
    [actionDate, setActionDate] = useState(
      new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
    ),
    [actionNote, setActionNote] = useState("기업행사 반영"),
    [competitionName, setCompetitionName] = useState("아미콤 모의투자 대회"),
    [competitionEndDate, setCompetitionEndDate] = useState(
      new Date(Date.now() + 30 * 86400000 + 9 * 3600000)
        .toISOString()
        .slice(0, 10),
    );
  const [themeCatalog, setThemeCatalog] = useState<StockThemeCatalog | null>(
    null,
  );
  const [themeFilter, setThemeFilter] = useState(initialLocation.themeFilter);
  const [themeLoading, setThemeLoading] = useState(false);
  const [themeError, setThemeError] = useState("");
  const [themeReload, setThemeReload] = useState(0);
  const themesBySymbol = useMemo(
    () => indexStockThemes(themeCatalog?.themes ?? []),
    [themeCatalog],
  );
  useEffect(() => {
    if (!user) return;
    let active = true;
    setThemeLoading(true);
    setThemeError("");
    api<StockThemeCatalog>("/stock-themes")
      .then((catalog) => {
        if (active) setThemeCatalog(catalog);
      })
      .catch((error) => {
        if (active) setThemeError(error.message);
      })
      .finally(() => {
        if (active) setThemeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, themeReload]);
  const [instrumentFilter, setInstrumentFilter] = useState(
    initialLocation.instrumentFilter,
  );
  const stockListRef = useRef<HTMLDivElement>(null);
  const [marketFilter, setMarketFilter] = useState(
      initialLocation.marketFilter,
    ),
    [stockPage, setStockPage] = useState(initialLocation.stockPage),
    [catalogDate, setCatalogDate] = useState<string | null>(null);
  const filteredStocks = useMemo(
    () =>
      stocks.filter(
        (s) =>
          (marketFilter === "ALL" || s.market === marketFilter) &&
          (instrumentFilter === "ALL" ||
            (s.instrument ?? "stock") === instrumentFilter) &&
          (!onlyStars || stars.includes(s.symbol)) &&
          matchesStockTheme(themesBySymbol.get(s.symbol) ?? [], themeFilter) &&
          matchesStockSearch(s, themesBySymbol.get(s.symbol) ?? [], search),
      ),
    [
      stocks,
      marketFilter,
      instrumentFilter,
      onlyStars,
      stars,
      search,
      themesBySymbol,
      themeFilter,
    ],
  );
  const themeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let unclassified = 0;
    for (const item of stocks) {
      if (
        (marketFilter !== "ALL" && item.market !== marketFilter) ||
        (instrumentFilter !== "ALL" &&
          (item.instrument ?? "stock") !== instrumentFilter) ||
        (onlyStars && !stars.includes(item.symbol))
      )
        continue;
      const themes = themesBySymbol.get(item.symbol) ?? [];
      if (!themes.length) unclassified++;
      for (const theme of themes)
        counts.set(theme.code, (counts.get(theme.code) ?? 0) + 1);
    }
    return {
      items: (themeCatalog?.themes ?? [])
        .map((theme) => ({ ...theme, count: counts.get(theme.code) ?? 0 }))
        .filter((theme) => theme.count > 0 || theme.code === themeFilter),
      unclassified,
    };
  }, [
    stocks,
    themeCatalog,
    themesBySymbol,
    marketFilter,
    instrumentFilter,
    onlyStars,
    stars,
    themeFilter,
  ]);
  function browseTheme(code: string) {
    setThemeFilter(code);
    setSearch("");
    setMarketFilter("ALL");
    setInstrumentFilter("ALL");
    setOnlyStars(false);
    if (isMobile) setStockPickerOpen(true);
    else
      document
        .querySelector(".stock-panel")
        ?.scrollIntoView({ block: "nearest" });
  }
  const pageCount = Math.max(1, Math.ceil(filteredStocks.length / 10));
  const currentStockPage = Math.min(stockPage, pageCount - 1);
  const visibleStocks = filteredStocks.slice(
    currentStockPage * 10,
    currentStockPage * 10 + 10,
  );
  const quoteSymbols = visibleStocks.map((s) => s.symbol).join(",");
  const navigation = useWorkspaceHistory(
    {
      page,
      symbol,
      period,
      tradeTab: mobileTradeTab,
      accountTab,
      search,
      onlyStars,
      marketFilter,
      instrumentFilter,
      themeFilter,
      stockPage,
      analysis: analysisView,
    },
    user?.id,
    (view) => {
      setPage(view.page);
      setSymbol(view.symbol);
      setPeriod(view.period);
      setMobileTradeTab(view.tradeTab);
      setAccountTab(view.accountTab);
      setSearch(view.search);
      setOnlyStars(view.onlyStars);
      setMarketFilter(view.marketFilter);
      setInstrumentFilter(view.instrumentFilter);
      setThemeFilter(view.themeFilter);
      setStockPage(view.stockPage);
      setAnalysisView(view.analysis);
      setChartView(null);
      setNewsFocus(null);
      setNewsDateFilter(null);
    },
  );
  useOrderDock(isMobile && page === "trade" && mobileTradeTab === "order");
  const filterKey = JSON.stringify([
    marketFilter,
    instrumentFilter,
    onlyStars,
    search,
    themeFilter,
  ]);
  const previousFilterKey = useRef(filterKey);
  useEffect(() => {
    if (
      previousFilterKey.current !== filterKey &&
      !navigation.restoring.current
    )
      setStockPage(0);
    previousFilterKey.current = filterKey;
  }, [filterKey]);
  useEffect(() => {
    if (stockListRef.current && !navigation.restoring.current)
      stockListRef.current.scrollTop = 0;
  }, [currentStockPage, filterKey]);
  useEffect(() => {
    const dialog = stockPicker.current;
    if (!dialog || !stockPickerOpen || !isMobile || page !== "trade") {
      setStockPickerOpen(false);
      return;
    }
    dialog.showModal();
    navigation.restoreList();
    dialog
      .querySelector<HTMLInputElement>('input[aria-label="종목 검색"]')
      ?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
    };
  }, [stockPickerOpen, isMobile, page]);
  useEffect(() => {
    if (
      user &&
      user.role !== "admin" &&
      (requestedPage === "education" || requestedPage === "admin")
    )
      setPage("trade");
  }, [requestedPage, user]);
  useEffect(() => {
    const element = mobileMenu.current;
    if (!element || !mobileMenuOpen || !isMobile || !user) {
      setMobileMenuOpen(false);
      return;
    }
    element.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = old;
    };
  }, [mobileMenuOpen, isMobile, user]);
  function switchTradeTab(
    next: "chart" | "book" | "order" | "financials" | "news",
  ) {
    setMobileTradeTab(next);
    const workspace = tradeWorkspace.current;
    if (isMobile && workspace && workspace.getBoundingClientRect().top < 0) {
      workspace.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }
  function openNewsChart(article: StockNewsArticle) {
    setNewsFocus({ symbol, article });
    setPeriod("D");
    switchTradeTab("chart");
    requestAnimationFrame(() =>
      (isMobile
        ? tradeWorkspace.current
        : document.getElementById("trade-chart-panel")
      )?.scrollIntoView({ block: "start", behavior: "instant" }),
    );
  }
  function openChartNews(day: string) {
    setNewsDateFilter({ symbol, day });
    switchTradeTab("news");
    requestAnimationFrame(() =>
      (isMobile
        ? tradeWorkspace.current
        : document.getElementById("trade-news-panel")
      )?.scrollIntoView({ block: "start", behavior: "instant" }),
    );
  }
  function selectStock(next: string) {
    setNewsFocus(null);
    setNewsDateFilter(null);
    setNewsData(null);
    setSymbol(next);
    setLimit("");
    setStockPickerOpen(false);
    switchTradeTab(mobileTradeTab === "financials" ? "financials" : "chart");
  }
  const orderRequest = useRef<string | null>(null),
    grantRequest = useRef<string | null>(null),
    actionRequest = useRef<string | null>(null),
    competitionRequest = useRef<string | null>(null);
  useEffect(() => {
    setQuantityRatio(null);
  }, [symbol, side, orderType, limit]);
  useEffect(() => {
    Promise.all([
      api<{ provider: string; tradingCosts: TradingCosts }>("/meta").then(
        (m) => {
          setProvider(m.provider);
          setTradingCosts(m.tradingCosts);
        },
      ),
      api<{ user: User }>("/me")
        .then((d) => setUser(d.user))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);
  const refresh = useCallback(async () => {
    setAccount(await api<Account>("/account"));
  }, []);
  useEffect(() => {
    if (!user || !quoteSymbols) {
      setQuotes([]);
      return;
    }
    let active = true,
      running = false;
    setQuotes([]);
    const load = async () => {
      if (running || !active) return;
      running = true;
      try {
        const d = await api<{ quotes: Quote[]; error: string | null }>(
          "/quotes?symbols=" + encodeURIComponent(quoteSymbols),
        );
        if (active) {
          setQuotes(d.quotes);
          setError(d.error || "");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        running = false;
      }
    };
    const first = setTimeout(load, 300);
    const interval = setInterval(load, 15000);
    return () => {
      active = false;
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [user, quoteSymbols]);

  useEffect(() => {
    if (!user) return;
    const stream = new EventSource("/api/stream?symbol=" + symbol);
    stream.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.status) setFeedStatus(d.status);
      if (d.kind === "market") {
        if (d.quote)
          setQuotes((old) => [
            ...old.filter((q) => q.symbol !== d.symbol),
            d.quote,
          ]);
        setDetail((old) =>
          old && old.quote.symbol === d.symbol
            ? {
                ...old,
                quote:
                  d.quote && d.quote.receivedAt >= old.quote.receivedAt
                    ? d.quote
                    : old.quote,
                book:
                  d.book && d.book.receivedAt >= old.book.receivedAt
                    ? d.book
                    : old.book,
              }
            : old,
        );
      }
      if (d.kind === "fill") {
        setToast(d.message);
        void refresh().catch((e) => setError(e.message));
      }
    };
    stream.onerror = () => setFeedStatus("조회 모드 · 재연결 중");
    return () => stream.close();
  }, [user, symbol, refresh]);
  const refreshAdmin = useCallback(async () => {
    const d = await api<{
      members: Member[];
      summary: AdminSummary;
      grants: Grant[];
      corporateActions: CorporateAction[];
      marketStatus: MarketStatus;
      competitions: Competition[];
    }>("/admin/members");
    setMembers(d.members);
    setAdminSummary(d.summary);
    setGrants(d.grants);
    setCorporateActions(d.corporateActions);
    setMarketStatus(d.marketStatus);
    setCompetitions(d.competitions);
  }, []);
  const refreshRanking = useCallback(async (competitionId?: number) => {
    const data = await api<RankingData>(
      "/ranking" + (competitionId ? "?competitionId=" + competitionId : ""),
    );
    setCompetition(data.competition);
    setCompetitions(data.competitions);
    setRanking(data.members);
  }, []);
  useEffect(() => {
    if (!user) return;
    try {
      setStars(
        JSON.parse(localStorage.getItem("study-stars-" + user.id) || "[]"),
      );
    } catch {
      setStars([]);
    }
    api<{ stocks: Stock[]; updatedAt: string | null }>("/stocks")
      .then((d) => {
        setStocks(d.stocks);
        setCatalogDate(d.updatedAt);
      })
      .catch((e) => setError(e.message));
    let active = true;
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try {
        await refresh();
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        running = false;
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [user, refresh]);
  useEffect(() => {
    if (!user) return;
    let active = true,
      running = false;
    setDetail(null);
    setDetailError("");
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const d = {
          ...(await api<Detail>("/stock/" + symbol + "?period=" + period)),
          chartPeriod: period,
        };
        if (active) {
          setDetail((old) =>
            old && old.quote.symbol === d.quote.symbol
              ? {
                  ...d,
                  quote:
                    old.quote.receivedAt > d.quote.receivedAt
                      ? old.quote
                      : d.quote,
                  book:
                    old.book.receivedAt > d.book.receivedAt ? old.book : d.book,
                }
              : d,
          );
          setDetailError("");
        }
      } catch (e) {
        if (active) {
          setDetail(null);
          setDetailError((e as Error).message);
        }
      } finally {
        running = false;
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [symbol, period, user]);
  useEffect(() => {
    if (page !== "admin" || user?.role !== "admin") return;
    let active = true;
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try {
        await refreshAdmin();
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        running = false;
      }
    };
    void load();
    const interval = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [page, user, refreshAdmin]);
  useEffect(() => {
    if (page === "ranking") refreshRanking().catch((e) => setError(e.message));
  }, [page, refreshRanking]);
  useEffect(() => {
    if (!user || page !== "account") return;
    let active = true,
      running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const data = await api<InvestmentAnalytics>("/analytics");
        if (active) setAnalytics(data);
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
  }, [user, page, account?.orders.length, account?.realized]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    orderRequest.current = null;
  }, [symbol, side, orderType, quantity, limit, note, tradePlan]);
  useEffect(() => {
    grantRequest.current = null;
  }, [grantUser, grantAmount, grantNote]);
  useEffect(() => {
    competitionRequest.current = null;
  }, [competitionName, competitionEndDate]);
  useEffect(() => {
    actionRequest.current = null;
  }, [
    actionSymbol,
    actionType,
    actionAmount,
    actionNumerator,
    actionDenominator,
    actionDate,
    actionNote,
  ]);
  function star(s: string) {
    const next = stars.includes(s)
      ? stars.filter((x) => x !== s)
      : [...stars, s];
    setStars(next);
    localStorage.setItem("study-stars-" + user!.id, JSON.stringify(next));
  }
  async function order(e: FormEvent) {
    e.preventDefault();
    if (busy || !detail || !account) return;
    if (quantityError) {
      setError(quantityError);
      return;
    }
    setBusy(true);
    setError("");
    try {
      orderRequest.current ??= crypto.randomUUID();
      const result = await api<{
        order: { status: string; filled_quantity: number; quantity: number };
      }>("/orders", {
        symbol,
        side,
        type: orderType,
        quantity: Number(quantity),
        ...(orderType === "limit" ? { limitPrice: Number(limit) } : {}),
        note,
        plan: tradePlan,
        requestId: orderRequest.current,
      });
      orderRequest.current = null;
      setToast(
        result.order.status === "filled"
          ? "주문이 모의 체결되었습니다."
          : result.order.status === "cancelled"
            ? result.order.filled_quantity +
              "주 체결, 미체결 잔량은 자동 취소되었습니다."
            : result.order.filled_quantity > 0
              ? result.order.filled_quantity +
                "주 부분 체결, 나머지는 대기 중입니다."
              : "지정가 주문이 접수되었습니다.",
      );
      setNote("");
      setTradePlan({ ...emptyPlan });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function grant(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      grantRequest.current ??= crypto.randomUUID();
      await api("/admin/grants", {
        userId: Number(grantUser),
        amount: Number(grantAmount),
        note: grantNote,
        requestId: grantRequest.current,
      });
      grantRequest.current = null;
      setToast("가상 투자금을 지급했습니다.");
      await Promise.all([refreshAdmin(), refresh()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function createCompetition(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (
      !window.confirm(
        "현재 평가자산을 시작 기준으로 전원 참가 대회를 시작할까요?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      competitionRequest.current ??= crypto.randomUUID();
      await api("/admin/competitions", {
        name: competitionName,
        endDate: competitionEndDate,
        requestId: competitionRequest.current,
      });
      competitionRequest.current = null;
      setToast("모의투자 대회를 시작했습니다.");
      await Promise.all([refreshAdmin(), refreshRanking()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelCompetition(item: Competition) {
    if (busy || item.status !== "active") return;
    const reason = window.prompt(
      "대회를 취소하는 이유를 입력해주세요. 계좌와 거래 기록은 유지됩니다.",
      "일정 변경",
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setError("취소 사유를 입력해주세요.");
      return;
    }
    if (!window.confirm("‘" + item.name + "’ 대회를 정말 취소할까요?")) return;
    setBusy(true);
    setError("");
    try {
      await api("/admin/competitions/" + item.id + "/cancel", {
        reason: reason.trim(),
      });
      setToast("모의투자 대회를 취소했습니다.");
      await Promise.all([refreshAdmin(), refreshRanking()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applyCorporateAction(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const label =
      actionType === "dividend"
        ? "주당 " + won(Number(actionAmount)) + "원 배당"
        : actionNumerator + ":" + actionDenominator + " 주식분할";
    if (
      !window.confirm(
        actionSymbol +
          "에 " +
          label +
          "을 적용할까요? 이 작업은 되돌릴 수 없습니다.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      actionRequest.current ??= crypto.randomUUID();
      await api("/admin/corporate-actions", {
        symbol: actionSymbol,
        type: actionType,
        ...(actionType === "dividend"
          ? { cashPerShare: Number(actionAmount) }
          : {
              numerator: Number(actionNumerator),
              denominator: Number(actionDenominator),
            }),
        effectiveDate: actionDate,
        note: actionNote,
        requestId: actionRequest.current,
      });
      actionRequest.current = null;
      setToast("기업행사를 반영했습니다.");
      await Promise.all([refreshAdmin(), refresh()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const stock = stocks.find((s) => s.symbol === symbol),
    q = detail?.quote;
  const selectedTaxBps =
    stock?.instrument === "etf" ? 0 : tradingCosts.sellTaxBps;
  const current = q?.price || 0;
  const held = account?.holdings.find((h) => h.symbol === symbol);
  const totalAssets =
    account && account.holdings.every((h) => h.price !== null)
      ? account.cash +
        account.holdings.reduce((s, h) => s + h.quantity * h.price!, 0)
      : null;
  const profit =
    totalAssets !== null ? totalAssets - (account?.deposits || 0) : null;
  const adminPage = page === "admin";
  const displayedAssets = adminPage
    ? (adminSummary?.assets ?? null)
    : totalAssets;
  const displayedProfit = adminPage ? (adminSummary?.profit ?? null) : profit;
  const displayedAvailable = adminPage
    ? (adminSummary?.available ?? null)
    : (account?.available ?? null);
  const displayedDeposits = adminPage
    ? (adminSummary?.deposits ?? null)
    : (account?.deposits ?? null);
  const displayedReserved = adminPage
    ? (adminSummary?.reserved ?? 0)
    : (account?.cash || 0) - (account?.available || 0);
  const displayedRate =
    displayedProfit !== null && displayedDeposits
      ? (displayedProfit / displayedDeposits) * 100
      : 0;
  const opposing =
    (side === "buy" ? detail?.book.asks : detail?.book.bids)
      ?.filter((l) => l.price > 0 && l.quantity > 0)
      .sort((a, b) =>
        side === "buy" ? a.price - b.price : b.price - a.price,
      ) ?? [];
  const displayBook = detail
    ? [
        ...detail.book.asks
          .filter((level) => level.price > 0 && level.quantity > 0)
          .reverse()
          .map((level) => ({ ...level, side: "ask" as const })),
        ...detail.book.bids
          .filter((level) => level.price > 0 && level.quantity > 0)
          .map((level) => ({ ...level, side: "bid" as const })),
      ]
    : [];
  const localBookState =
    provider === "kis" && detail ? bookState(detail.book) : null;
  const execution =
    provider === "kis"
      ? (clockState() ??
        (localBookState && !localBookState.canTrade
          ? localBookState
          : detail?.execution))
      : detail?.execution;
  const orderPrice =
    orderType === "market" ? (opposing[0]?.price ?? 0) : Number(limit);
  let expectedAmount = 0,
    expectedFilled = 0,
    expectedFee = 0,
    expectedTax = 0,
    affordable = 0,
    budget = account?.available ?? 0;
  for (const level of opposing) {
    const take = Math.min(
      Math.max(0, Number(quantity) - expectedFilled),
      level.quantity,
    );
    expectedAmount += take * level.price;
    expectedFee += Math.floor(
      (take * level.price * tradingCosts.commissionBps) / 10000,
    );
    if (side === "sell")
      expectedTax += Math.floor((take * level.price * selectedTaxBps) / 10000);
    expectedFilled += take;
    let canBuy = Math.min(level.quantity, Math.floor(budget / level.price));
    while (
      canBuy > 0 &&
      canBuy * level.price +
        Math.floor(
          (canBuy * level.price * tradingCosts.commissionBps) / 10000,
        ) >
        budget
    )
      canBuy--;
    affordable += canBuy;
    const affordableValue = canBuy * level.price;
    budget -=
      affordableValue +
      Math.floor((affordableValue * tradingCosts.commissionBps) / 10000);
  }
  const maxQty =
    side === "buy"
      ? orderType === "market"
        ? affordable
        : Math.floor(
            (account?.available || 0) /
              ((orderPrice || Infinity) *
                (1 + tradingCosts.commissionBps / 10000)),
          )
      : availableSellQuantity(held);
  const quantityError =
    !Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1
      ? "주문 수량은 1주 이상 정수로 입력해주세요."
      : Number(quantity) > MAX_ORDER_QUANTITY
        ? "한 번에 최대 1,000,000주까지 주문할 수 있어요."
        : account && side === "sell" && Number(quantity) > maxQty
          ? `매도 가능 수량은 ${won(maxQty)}주예요.`
          : "";
  const quantityUnavailable = !account
    ? "계좌 수량을 불러오고 있어요."
    : maxQty > 0
      ? ""
      : side === "sell"
        ? held?.quantity
          ? "보유 수량이 모두 매도 예약 중이에요. 미체결 주문을 확인해주세요."
          : `${stock?.name || symbol} 보유 수량이 없어 매도할 수 없어요.`
        : orderType === "limit" && !orderPrice
          ? "지정가를 입력하면 비율로 수량을 선택할 수 있어요."
          : orderType === "market" && !orderPrice
            ? "호가를 수신하면 매수 가능 수량을 계산해요."
            : "주문 가능 금액으로 매수할 수 있는 수량이 없어요.";
  const pending = account?.orders.filter((o) => o.status === "pending") || [];
  const stockExplorer = (
    <section className="panel stock-panel">
      <div className="panel-heading">
        <h2 id="stock-picker-title">종목 탐색</h2>
        <span className="muted">{stocks.length}종목</span>
        {isMobile && (
          <button
            type="button"
            className="stock-picker-close"
            aria-label="종목 탐색 닫기"
            onClick={() => setStockPickerOpen(false)}
          >
            <X size={22} />
          </button>
        )}
      </div>
      <label className="search">
        <Search size={16} />
        <input
          aria-label="종목 검색"
          autoFocus={isMobile}
          autoComplete="off"
          placeholder="종목명·코드·테마 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="small-tabs">
        <button
          className={!onlyStars ? "selected" : ""}
          onClick={() => setOnlyStars(false)}
        >
          전체 종목
        </button>
        <button
          className={onlyStars ? "selected" : ""}
          onClick={() => setOnlyStars(true)}
        >
          관심 종목 <span>{stars.length}</span>
        </button>
      </div>
      <details className="stock-filters">
        <summary>
          필터{" "}
          <span>
            {[
              marketFilter !== "ALL" ? marketFilter : "",
              instrumentFilter !== "ALL"
                ? instrumentFilter === "etf"
                  ? "ETF"
                  : "주식"
                : "",
              themeFilter !== "ALL"
                ? themeFilter === "UNCLASSIFIED"
                  ? "테마 미분류"
                  : themeCatalog?.themes.find((t) => t.code === themeFilter)
                      ?.name
                : "",
            ]
              .filter(Boolean)
              .join(" · ") || "시장·상품·테마"}
          </span>
        </summary>
        <div className="market-filter" role="group" aria-label="주식 시장 선택">
          {[
            ["ALL", "전체"],
            ["KOSPI", "코스피"],
            ["KOSDAQ", "코스닥"],
          ].map(([key, label]) => (
            <button
              key={key}
              aria-pressed={marketFilter === key}
              className={marketFilter === key ? "selected" : ""}
              onClick={() => setMarketFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="market-filter" role="group" aria-label="상품 유형 선택">
          {[
            ["ALL", "전체 상품"],
            ["stock", "주식"],
            ["etf", "ETF"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={instrumentFilter === key}
              className={instrumentFilter === key ? "selected" : ""}
              onClick={() => setInstrumentFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="theme-filter">
          테마
          <select
            aria-label="테마 분류"
            value={themeFilter}
            disabled={!themeCatalog || themeLoading}
            onChange={(event) => setThemeFilter(event.target.value)}
          >
            <option value="ALL">
              {themeLoading
                ? "테마 불러오는 중…"
                : themeCatalog
                  ? "전체 테마"
                  : "테마 조회 필요"}
            </option>
            {themeOptions.items.map((theme) => (
              <option key={theme.code} value={theme.code}>
                {theme.name} ({theme.count})
              </option>
            ))}
            {themeCatalog && (
              <option value="UNCLASSIFIED">
                테마 미분류 ({themeOptions.unclassified})
              </option>
            )}
          </select>
        </label>
        {themeError && (
          <div className="theme-error" aria-live="polite">
            <span>테마를 불러오지 못했습니다.</span>
            <button
              type="button"
              disabled={themeLoading}
              onClick={() => setThemeReload((value) => value + 1)}
            >
              다시 시도
            </button>
          </div>
        )}
      </details>
      <div className="stock-result-count">
        <span>
          {filteredStocks.length.toLocaleString()}종목
          {themeFilter !== "ALL" ? " · 테마 적용" : " · 주요 종목 우선"}
        </span>
        {(themeFilter !== "ALL" ||
          marketFilter !== "ALL" ||
          instrumentFilter !== "ALL" ||
          onlyStars ||
          search) && (
          <button
            type="button"
            onClick={() => {
              setThemeFilter("ALL");
              setMarketFilter("ALL");
              setInstrumentFilter("ALL");
              setOnlyStars(false);
              setSearch("");
            }}
          >
            필터 초기화
          </button>
        )}
      </div>
      <div
        className="stock-list"
        ref={stockListRef}
        role="region"
        aria-label="종목 목록"
        tabIndex={0}
      >
        {visibleStocks.map((s) => {
          const sq = quotes.find((q) => q.symbol === s.symbol);
          const assignedThemes = themesBySymbol.get(s.symbol) ?? [];
          const listedThemes = [...assignedThemes].sort(
            (a, b) =>
              Number(
                b.code === themeFilter ||
                  (search.trim() &&
                    b.name.toLowerCase().includes(search.trim().toLowerCase())),
              ) -
              Number(
                a.code === themeFilter ||
                  (search.trim() &&
                    a.name.toLowerCase().includes(search.trim().toLowerCase())),
              ),
          );
          return (
            <div
              key={s.symbol}
              className={"stock-row " + (symbol === s.symbol ? "selected" : "")}
            >
              <button
                aria-label={s.name + " 관심 종목"}
                className={"star " + (stars.includes(s.symbol) ? "on" : "")}
                onClick={() => star(s.symbol)}
              >
                <Star
                  size={15}
                  fill={stars.includes(s.symbol) ? "currentColor" : "none"}
                />
              </button>
              <button
                className="stock-select"
                onClick={() => selectStock(s.symbol)}
              >
                <span className="stock-main">
                  <StockLogo symbol={s.symbol} name={s.name} size="sm" />
                  <span className="stock-label">
                    <b title={s.name}>{s.name}</b>
                    <small>
                      {s.symbol} · {s.market}
                      {s.instrument === "etf" && " · ETF"}
                    </small>
                    {themeCatalog && (
                      <span
                        className="stock-theme-preview"
                        title={assignedThemes
                          .map((theme) => theme.name)
                          .join(" · ")}
                      >
                        {listedThemes.length
                          ? listedThemes
                              .slice(0, 2)
                              .map((theme) => theme.name)
                              .join(" · ") +
                            (listedThemes.length > 2
                              ? " +" + (listedThemes.length - 2)
                              : "")
                          : "테마 미분류"}
                      </span>
                    )}
                  </span>
                </span>
                <span className="stock-price">
                  <b>{sq ? won(sq.price) : "—"}</b>
                  <small className={sq && sq.change >= 0 ? "up" : "down"}>
                    {sq ? pct(sq.changeRate) : "조회 중"}
                  </small>
                </span>
              </button>
            </div>
          );
        })}
        {filteredStocks.length === 0 && (
          <div className="empty small">
            검색 결과가 없습니다.
            <span>검색어나 테마·시장 조건을 바꿔보세요.</span>
          </div>
        )}
      </div>
      <div className="stock-pagination">
        <button
          aria-label="이전 종목 페이지"
          disabled={currentStockPage === 0}
          onClick={() => setStockPage(currentStockPage - 1)}
        >
          이전
        </button>
        <span>
          {currentStockPage + 1} / {pageCount}
        </span>
        <button
          aria-label="다음 종목 페이지"
          disabled={currentStockPage + 1 >= pageCount}
          onClick={() => setStockPage(currentStockPage + 1)}
        >
          다음
        </button>
      </div>
      <div
        className="stock-foot"
        title={
          catalogDate ? "종목 목록 갱신: " + date(catalogDate) : "기본 목록"
        }
      >
        <span className="status-dot" />
        {provider === "demo"
          ? "샘플 시세 · 실제 가격 아님"
          : "주식·ETF 지원 · ETN 미지원"}
      </div>
      {themeCatalog && (
        <p className="theme-source">
          테마: 한국투자증권 ·{" "}
          {new Date(themeCatalog.updatedAt).toLocaleDateString("ko-KR")} 갱신
        </p>
      )}
    </section>
  );
  const bookPanel = (
    <section
      className="panel book-panel"
      id="trade-book-panel"
      role={isMobile ? "tabpanel" : undefined}
      aria-labelledby={isMobile ? "trade-book-tab" : undefined}
      hidden={isMobile && mobileTradeTab !== "book"}
    >
      <div className="panel-heading">
        <h2>호가</h2>
        <small className="muted">
          {provider === "demo" ? "샘플 호가" : "조회 호가"}
        </small>
      </div>
      <p className="book-order-hint">가격을 누르면 지정가 주문에 입력됩니다.</p>
      <div className="book-label">
        <span>가격 (원)</span>
        <span>잔량 (주)</span>
      </div>
      {displayBook.length ? (
        displayBook.map((b, i) => (
          <button
            className={"book-row " + b.side}
            aria-pressed={orderType === "limit" && Number(limit) === b.price}
            aria-label={
              (b.side === "ask" ? "매도 호가 " : "매수 호가 ") +
              won(b.price) +
              "원 · 잔량 " +
              won(b.quantity) +
              "주 · 지정가 입력"
            }
            key={i}
            onClick={() => {
              setOrderType("limit");
              setLimit(String(b.price));
              switchTradeTab("order");
            }}
          >
            <span
              className="book-bar"
              style={{
                width: Math.min(100, b.quantity / 100) + "%",
              }}
            />
            <b>{won(b.price)}</b>
            <span>{won(b.quantity)}</span>
          </button>
        ))
      ) : (
        <div className="empty small">
          {detail
            ? "현재 표시할 수 있는 유효 호가가 없습니다."
            : "호가를 불러오는 중입니다."}
        </div>
      )}
    </section>
  );
  async function logout() {
    try {
      await api("/logout", {});
      setUser(null);
      setAccount(null);
      setPage("trade");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const activeChartView =
    chartView?.userId === user?.id &&
    chartView?.symbol === symbol &&
    chartView?.period === period
      ? chartView
      : null;
  if (loading)
    return (
      <div className="loading-screen">
        <Activity /> 투자실을 준비하고 있어요…
      </div>
    );
  if (!user) return <Login onLogin={setUser} provider={provider} />;
  return (
    <div className="app">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("trade");
          }}
        >
          <BrandLogo />
          <span>
            아미콤<span className="brand-en">STUDY INVEST</span>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">
            <GraduationCap size={20} />
          </span>
          <div>
            아미콤 투자 스터디<small>함께 배우는 투자 습관</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="주요 메뉴">
          {[
            ["trade", "트레이딩", BarChart3],
            ["analysis", "시장 분석", TrendingUp],
            ...(user.role === "admin"
              ? [["education", "투자 교육", GraduationCap]]
              : []),
            ["account", "내 투자 계좌", Wallet],
            ["ranking", "스터디 랭킹", Trophy],
            ...(user.role === "admin"
              ? [["admin", "관리자", ShieldCheck]]
              : []),
          ]
            .filter(
              ([key]) => !isMobile || (key !== "ranking" && key !== "admin"),
            )
            .map(([key, label, Icon]) => {
              const I = Icon as typeof BarChart3;
              return (
                <button
                  key={String(key)}
                  className={page === key ? "nav-item active" : "nav-item"}
                  aria-label={String(label)}
                  aria-current={page === key ? "page" : undefined}
                  onClick={() => {
                    setPage(String(key));
                    if (key === "education")
                      window.scrollTo({ top: 0, behavior: "instant" });
                  }}
                >
                  <I size={19} />
                  <span>
                    {isMobile && key === "account"
                      ? "내 계좌"
                      : isMobile && key === "ranking"
                        ? "랭킹"
                        : String(label)}
                  </span>
                  {page === key && <span className="nav-dot" />}
                </button>
              );
            })}
          {isMobile && (
            <button
              type="button"
              className={
                page === "ranking" || page === "admin"
                  ? "nav-item active"
                  : "nav-item"
              }
              aria-label="더보기"
              aria-haspopup="dialog"
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen(true)}
            >
              <MoreHorizontal size={19} />
              <span>더보기</span>
            </button>
          )}
        </nav>
        <div className="side-bottom">
          <div className="study-tip">
            <GraduationCap size={22} />
            <strong>작게 시작하고, 함께 성장해요.</strong>
            <p>
              매매 이유를 남겨보세요.
              <br />
              오늘의 판단이 내일의 배움이 됩니다.
            </p>
          </div>
          <button
            className="profile"
            onClick={logout}
            title="로그아웃"
            aria-label="로그아웃"
          >
            <span className="avatar">{user.name[0]}</span>
            <span>
              {user.name}
              <small>
                {user.role === "admin" ? "스터디 관리자" : "스터디 멤버"}
              </small>
            </span>
            <LogOut size={16} />
            <span className="mobile-profile-label">로그아웃</span>
          </button>
        </div>
      </aside>
      {isMobile && (
        <dialog
          ref={mobileMenu}
          className="mobile-more-menu"
          aria-label="더보기 메뉴"
          onCancel={() => setMobileMenuOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setMobileMenuOpen(false);
          }}
        >
          <header>
            <h2>더보기</h2>
            <button
              type="button"
              aria-label="더보기 닫기"
              onClick={() => setMobileMenuOpen(false)}
            >
              <X size={18} />
            </button>
          </header>
          <button
            type="button"
            onClick={() => {
              setPage("ranking");
              setMobileMenuOpen(false);
            }}
          >
            <Trophy size={18} />
            스터디 랭킹
          </button>
          {user.role === "admin" && (
            <button
              type="button"
              onClick={() => {
                setPage("admin");
                setMobileMenuOpen(false);
              }}
            >
              <ShieldCheck size={18} />
              관리자
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              void logout();
            }}
          >
            <LogOut size={18} />
            로그아웃
          </button>
        </dialog>
      )}
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            워크스페이스 <ChevronRight size={14} />
            <b>
              {
                {
                  trade: "트레이딩",
                  analysis: "시장 분석",
                  education: "투자 교육",
                  account: "내 투자 계좌",
                  ranking: "스터디 랭킹",
                  admin: "관리자",
                }[page]
              }
            </b>
          </div>
          <div className="top-status">
            <span className="status-dot" />
            {provider === "demo" ? "샘플 시세 모드" : "KIS · " + feedStatus}
            <span className="virtual-tag">모의투자</span>
          </div>
        </header>
        <div className={"main-content workspace-" + page}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR NEXT INVESTMENT, TOGETHER</div>
              <h1>
                {
                  {
                    trade: "시장을 읽고, 투자를 연습해요.",
                    analysis: "시장 분석",
                    education: "배우고, 실습하고, 함께 발표해요.",
                    account: "나의 투자, 한눈에.",
                    ranking: "함께 쌓아가는 투자 경험.",
                    admin: "우리 스터디의 시작을 준비해요.",
                  }[page]
                }
              </h1>
              <p>
                {
                  {
                    trade:
                      "실제 종목으로 배우는 투자. 모든 거래는 가상 자산으로 진행됩니다.",
                    analysis:
                      "상·하한가 포착과 급등락, 거래량을 날짜별로 확인하세요.",
                    education:
                      "1~8주차 투자 커리큘럼과 발표 자료를 한곳에서 확인하세요.",
                    account:
                      "보유 자산과 거래 기록을 확인하고 투자 과정을 돌아보세요.",
                    ranking:
                      "지급받은 가상 투자금 대비 누적 수익률을 비교해보세요.",
                    admin:
                      "멤버에게 가상 투자금을 지급하고 지급 내역을 관리하세요.",
                  }[page]
                }
              </p>
            </div>
            <span className="date-chip">
              <Clock3 size={14} />
              {new Date().toLocaleDateString("ko-KR", {
                month: "long",
                day: "numeric",
                weekday: "short",
              })}
            </span>
          </div>
          {provider === "demo" && (
            <div className="mode-banner">
              <span className="banner-dot" />
              <strong>샘플 데이터로 체험 중이에요</strong>
              <span>표시된 가격·차트·호가는 실제 시장 데이터가 아닙니다.</span>
            </div>
          )}
          {error && (
            <div role="alert" className="error-banner">
              {error}
              <button onClick={() => setError("")} aria-label="오류 닫기">
                <X size={16} />
              </button>
            </div>
          )}
          {page === "trade" && (
            <section className="trade-account-summary" aria-label="투자금 요약">
              {[
                ["총 자산", displayedAssets],
                ["투자 손익", displayedProfit],
                ["주문 가능", displayedAvailable],
              ].map(([label, value]) => (
                <button
                  key={String(label)}
                  type="button"
                  onClick={() => setPage("account")}
                  title={
                    String(label) +
                    " " +
                    (value === null ? "조회 중" : won(Number(value)) + "원")
                  }
                >
                  <span>{label}</span>
                  <b
                    className={
                      label === "투자 손익"
                        ? Number(value) < 0
                          ? "down"
                          : "up"
                        : ""
                    }
                  >
                    {value === null ? "—" : compactMoney(Number(value))}
                  </b>
                </button>
              ))}
            </section>
          )}
          {page !== "trade" && page !== "analysis" && page !== "education" && (
            <section className="summary-grid">
              <Summary
                title={adminPage ? "스터디 총 평가자산" : "총 평가자산"}
                value={displayedAssets === null ? "—" : won(displayedAssets)}
                unit="원"
                icon={<Wallet size={18} />}
                sub={
                  adminPage
                    ? "전체 멤버 현금 + 보유 주식 평가금액"
                    : "현금 + 보유 주식 평가금액"
                }
              />
              <Summary
                title={adminPage ? "스터디 총 투자손익" : "총 투자손익"}
                value={
                  displayedProfit === null
                    ? "—"
                    : (displayedProfit > 0 ? "+" : "") + won(displayedProfit)
                }
                unit="원"
                color={
                  displayedProfit !== null && displayedProfit < 0
                    ? "down"
                    : "up"
                }
                sub={
                  displayedDeposits
                    ? (adminPage ? "전체 누적 수익률 " : "누적 수익률 ") +
                      pct(displayedRate)
                    : "투자금 지급 후 수익률이 표시됩니다."
                }
                icon={<Activity size={18} />}
              />
              <Summary
                title={adminPage ? "스터디 주문 가능 금액" : "주문 가능 금액"}
                value={
                  displayedAvailable === null ? "—" : won(displayedAvailable)
                }
                unit="원"
                sub={
                  (adminPage ? "전체 주문 예약금 " : "주문 예약금 ") +
                  won(displayedReserved) +
                  "원"
                }
                icon={<ArrowDownLeft size={18} />}
              />
              <Summary
                title={
                  adminPage ? "스터디 누적 지급 투자금" : "누적 지급 투자금"
                }
                value={
                  displayedDeposits === null ? "—" : won(displayedDeposits)
                }
                unit="원"
                sub={
                  adminPage
                    ? "전체 멤버에게 지급한 가상 투자금"
                    : "관리자가 지급한 가상 투자금"
                }
                icon={<GraduationCap size={18} />}
              />
            </section>
          )}
          {page === "education" && user.role === "admin" && (
            <Suspense
              fallback={<p role="status">교육 자료를 불러오고 있습니다.</p>}
            >
              <InvestmentEducation
                onPractice={(next) => {
                  setPage(next);
                  window.scrollTo({ top: 0, behavior: "instant" });
                }}
              />
            </Suspense>
          )}
          {page === "analysis" && (
            <MarketAnalysis
              view={analysisView}
              onViewChange={setAnalysisView}
              onNewsSelect={(nextSymbol, article) => {
                selectStock(nextSymbol);
                setNewsFocus({ symbol: nextSymbol, article });
                setPeriod("D");
                setPage("trade");
                requestAnimationFrame(() =>
                  tradeWorkspace.current?.scrollIntoView({
                    block: "start",
                    behavior: "instant",
                  }),
                );
              }}
              themes={themeCatalog}
              availableSymbols={new Set(stocks.map((stock) => stock.symbol))}
              onSelect={(symbol) => {
                selectStock(symbol);
                setPage("trade");
              }}
            />
          )}
          {page === "trade" && (
            <>
              <div className="trade-workspace" ref={tradeWorkspace}>
                {!isMobile && (
                  <div
                    className="desktop-stock-views"
                    role="group"
                    aria-label="종목 보기"
                  >
                    <button
                      type="button"
                      aria-pressed={mobileTradeTab !== "financials"}
                      onClick={() => switchTradeTab("chart")}
                    >
                      차트·주문
                    </button>
                    <button
                      type="button"
                      aria-pressed={mobileTradeTab === "financials"}
                      onClick={() => switchTradeTab("financials")}
                    >
                      종목 분석
                    </button>
                  </div>
                )}
                {isMobile && (
                  <div className="mobile-trade-header">
                    <div className="mobile-instrument">
                      <StockLogo
                        symbol={symbol}
                        name={stock?.name || symbol}
                        size="sm"
                      />
                      <div>
                        <strong>{stock?.name || symbol}</strong>
                        <small>
                          {symbol} · {stock?.market}
                          {stock?.instrument === "etf" && " · ETF"}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="stock-picker-trigger"
                        aria-haspopup="dialog"
                        aria-expanded={stockPickerOpen}
                        onClick={() => setStockPickerOpen(true)}
                      >
                        <Search size={16} /> 종목 변경
                      </button>
                    </div>
                    <div className="mobile-quote">
                      <strong>
                        {q ? won(q.price) + "원" : "시세 조회 중"}
                      </strong>
                      <span className={q && q.change >= 0 ? "up" : "down"}>
                        {q ? pct(q.changeRate) : "—"}
                      </span>
                    </div>
                    <div
                      className="mobile-trade-tabs"
                      role="tablist"
                      aria-label="종목 거래 화면"
                    >
                      {(
                        [
                          ["chart", "차트"],
                          ["book", "호가"],
                          ["order", "주문"],
                          ["financials", "분석"],
                          ["news", "뉴스"],
                        ] as const
                      ).map(([key, label], index, tabs) => (
                        <button
                          key={key}
                          type="button"
                          role="tab"
                          aria-label={
                            key === "financials" ? "종목 분석" : undefined
                          }
                          id={"trade-" + key + "-tab"}
                          aria-controls={"trade-" + key + "-panel"}
                          aria-selected={mobileTradeTab === key}
                          tabIndex={mobileTradeTab === key ? 0 : -1}
                          onClick={() => switchTradeTab(key)}
                          onKeyDown={(event) => {
                            const next =
                              event.key === "ArrowRight"
                                ? (index + 1) % tabs.length
                                : event.key === "ArrowLeft"
                                  ? (index + tabs.length - 1) % tabs.length
                                  : event.key === "Home"
                                    ? 0
                                    : event.key === "End"
                                      ? tabs.length - 1
                                      : -1;
                            if (next < 0) return;
                            event.preventDefault();
                            switchTradeTab(tabs[next][0]);
                            document
                              .getElementById("trade-" + tabs[next][0] + "-tab")
                              ?.focus();
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {isMobile && themeCatalog && (
                  <StockThemeTags
                    key={symbol}
                    themes={themesBySymbol.get(symbol) ?? []}
                    onSelect={browseTheme}
                  />
                )}
                <div
                  className={
                    "trade-grid" +
                    (mobileTradeTab === "financials" ? " financial-view" : "")
                  }
                >
                  {!isMobile && stockExplorer}
                  <section
                    className="panel chart-panel"
                    id="trade-chart-panel"
                    role={isMobile ? "tabpanel" : undefined}
                    aria-labelledby={isMobile ? "trade-chart-tab" : undefined}
                    hidden={
                      mobileTradeTab === "financials" ||
                      (isMobile && mobileTradeTab !== "chart")
                    }
                  >
                    <div className="instrument">
                      <StockLogo
                        key={stock?.symbol || symbol}
                        symbol={stock?.symbol || symbol}
                        name={stock?.name || "종목"}
                        size="lg"
                        className="stock-avatar"
                      />
                      <div>
                        <h2>
                          {stock?.name || "종목 불러오는 중"}{" "}
                          <span>{stock?.symbol}</span>
                        </h2>
                        <small>
                          {stock?.market} · {stock?.sector}
                        </small>
                      </div>
                      <button
                        className={
                          "star instrument-star " +
                          (stars.includes(symbol) ? "on" : "")
                        }
                        aria-label="선택 종목 관심 등록"
                        onClick={() => star(symbol)}
                      >
                        <Star
                          size={20}
                          fill={
                            stars.includes(symbol) ? "currentColor" : "none"
                          }
                        />
                      </button>
                    </div>
                    <div className="quote-line">
                      <strong>
                        {q ? won(q.price) : "—"}
                        <span>원</span>
                      </strong>
                      <span className={q && q.change >= 0 ? "up" : "down"}>
                        {q
                          ? (q.change > 0 ? "+" : "") +
                            won(q.change) +
                            " (" +
                            pct(q.changeRate) +
                            ")"
                          : "시세 조회 중"}
                      </span>
                    </div>
                    <div className="quote-stats">
                      <span>
                        시가 <b>{q ? won(q.open) : "—"}</b>
                      </span>
                      <span>
                        고가 <b className="up">{q ? won(q.high) : "—"}</b>
                      </span>
                      <span>
                        저가 <b className="down">{q ? won(q.low) : "—"}</b>
                      </span>
                      <span>
                        거래량 <b>{q ? won(q.volume) : "—"}</b>
                      </span>
                    </div>
                    {!isMobile && themeCatalog && (
                      <StockThemeTags
                        key={symbol}
                        themes={themesBySymbol.get(symbol) ?? []}
                        onSelect={browseTheme}
                      />
                    )}
                    {stock?.instrument === "etf" && (
                      <EtfDetails key={symbol} symbol={symbol} />
                    )}
                    <div className="chart-toolbar">
                      <div className="small-tabs">
                        {[
                          ["D", "일봉"],
                          ["W", "주봉"],
                          ["M", "월봉"],
                        ].map(([p, label]) => (
                          <button
                            key={p}
                            className={period === p ? "selected" : ""}
                            onClick={() => setPeriod(p)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <button
                        className="chart-expand"
                        aria-label="자세히 보기 · 그리기"
                        onClick={() => setChartExpanded(true)}
                      >
                        <BarChart3 size={14} />
                        <span className="chart-expand-label">
                          자세히 보기 · 그리기
                        </span>
                        <span className="chart-expand-short" aria-hidden="true">
                          확대
                        </span>
                      </button>
                    </div>
                    {detail ? (
                      <Chart
                        key={symbol + period}
                        bars={detail.candles.slice(-100)}
                        news={
                          period === "D" && newsData?.symbol === symbol
                            ? newsData.articles
                            : []
                        }
                        focusedArticle={
                          period === "D" && newsFocus?.symbol === symbol
                            ? newsFocus.article
                            : null
                        }
                        onNewsDate={openChartNews}
                        onClearFocus={() => setNewsFocus(null)}
                      />
                    ) : (
                      <div className="chart-empty">
                        {detailError || "차트를 불러오고 있어요…"}
                      </div>
                    )}
                    <div className="chart-footer">
                      <span>
                        {provider === "demo"
                          ? "SAMPLE DATA"
                          : "KOREA INVESTMENT & SECURITIES"}
                      </span>
                      <span>
                        {q
                          ? "수신 " +
                            new Date(q.receivedAt).toLocaleTimeString("ko-KR")
                          : "연결 대기"}
                      </span>
                    </div>
                  </section>
                  <div
                    className="trade-execution"
                    hidden={mobileTradeTab === "financials"}
                  >
                    {bookPanel}
                    <section
                      className="panel order-panel"
                      id="trade-order-panel"
                      role={isMobile ? "tabpanel" : undefined}
                      aria-labelledby={isMobile ? "trade-order-tab" : undefined}
                      hidden={isMobile && mobileTradeTab !== "order"}
                    >
                      <div className="panel-heading">
                        <h2>주문하기</h2>
                        <span className="virtual-tag">가상 거래</span>
                      </div>
                      <div className="order-side">
                        <button
                          className={side === "buy" ? "buy active" : ""}
                          onClick={() => setSide("buy")}
                        >
                          매수
                        </button>
                        <button
                          className={side === "sell" ? "sell active" : ""}
                          onClick={() => setSide("sell")}
                        >
                          매도
                        </button>
                      </div>
                      {isMobile && (
                        <div className="mobile-order-budget">
                          <span>
                            {side === "sell"
                              ? "매도 가능 수량"
                              : "주문 가능 금액"}
                          </span>
                          <strong>
                            {account
                              ? side === "sell"
                                ? won(maxQty) + "주"
                                : won(account.available) + "원"
                              : "—"}
                          </strong>
                        </div>
                      )}
                      <form onSubmit={order}>
                        <label>
                          주문 유형
                          <select
                            value={orderType}
                            onChange={(e) =>
                              setOrderType(e.target.value as "market" | "limit")
                            }
                          >
                            <option value="market">시장가</option>
                            <option value="limit">지정가</option>
                          </select>
                        </label>
                        <label>
                          주문 가격
                          <div className="input-unit">
                            <input
                              aria-label="주문 가격"
                              type="number"
                              inputMode="numeric"
                              min="1"
                              max="100000000"
                              step="1"
                              required={orderType === "limit"}
                              disabled={orderType === "market"}
                              placeholder="가격 입력"
                              value={
                                orderType === "market"
                                  ? orderPrice || ""
                                  : limit
                              }
                              onChange={(e) => setLimit(e.target.value)}
                            />
                            <span>원</span>
                          </div>
                        </label>
                        <label>
                          주문 수량
                          <div className="input-unit">
                            <input
                              aria-label="주문 수량"
                              type="number"
                              inputMode="numeric"
                              min="1"
                              max={
                                side === "sell" && account
                                  ? Math.min(maxQty, MAX_ORDER_QUANTITY)
                                  : MAX_ORDER_QUANTITY
                              }
                              step="1"
                              required
                              value={quantity}
                              aria-describedby="order-quantity-help"
                              aria-invalid={
                                account && !quantityUnavailable && quantityError
                                  ? true
                                  : undefined
                              }
                              onChange={(e) => {
                                setQuantityRatio(null);
                                setQuantity(e.target.value);
                              }}
                            />
                            <span>주</span>
                          </div>
                        </label>
                        <div
                          className={
                            "quantity-shortcuts order-quantity-shortcuts " +
                            side
                          }
                          role="group"
                          aria-label="주문 수량 비율"
                        >
                          {([25, 50, 100] as const).map((n) => (
                            <button
                              type="button"
                              key={n}
                              aria-label={n === 100 ? "최대" : n + "%"}
                              aria-describedby={
                                "order-quantity-help quantity-preview-" + n
                              }
                              aria-pressed={
                                quantityRatio === n &&
                                Number(quantity) === quantityAtRatio(maxQty, n)
                              }
                              disabled={busy || !account || maxQty < 1}
                              onClick={() => {
                                setQuantityRatio(n);
                                setQuantity(String(quantityAtRatio(maxQty, n)));
                              }}
                            >
                              <span>{n === 100 ? "최대" : n + "%"}</span>
                              <small id={"quantity-preview-" + n}>
                                {account
                                  ? won(quantityAtRatio(maxQty, n)) + "주"
                                  : "—"}
                              </small>
                            </button>
                          ))}
                        </div>
                        <div className="order-available">
                          <span>{side === "buy" ? "매수" : "매도"} 가능</span>
                          <b>{account ? won(maxQty) + "주" : "—"}</b>
                        </div>
                        <div
                          className="order-quantity-help"
                          id="order-quantity-help"
                          aria-live="polite"
                        >
                          {side === "sell" && account && (
                            <span>
                              {stock?.name || symbol} 보유{" "}
                              {won(held?.quantity || 0)}주 · 매도 예약{" "}
                              {won(held?.reserved || 0)}주
                            </span>
                          )}
                          {quantityUnavailable ? (
                            <span>{quantityUnavailable}</span>
                          ) : quantityError ? (
                            <span className="quantity-error">
                              {quantityError}
                            </span>
                          ) : (
                            <span>
                              비율은{" "}
                              {side === "sell"
                                ? "매도 가능 수량"
                                : "매수 가능 수량"}{" "}
                              기준 · 1주 미만은 1주로 설정해요.
                            </span>
                          )}
                          {maxQty > MAX_ORDER_QUANTITY && (
                            <span>1회 주문 한도는 1,000,000주예요.</span>
                          )}
                          {account && side === "sell" && maxQty === 0 && (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => {
                                setAccountTab(
                                  held?.reserved ? "pending" : "holdings",
                                );
                                setPage("account");
                              }}
                            >
                              {held?.reserved
                                ? "미체결 주문 확인"
                                : "보유 종목 확인"}
                            </button>
                          )}
                        </div>
                        <TradingStateNotice state={execution} />
                        {stock?.instrument === "etf" && (
                          <small className="etf-order-note">
                            ETF 호가: 2,000원 미만 1원 · 이상 5원 단위. 매도
                            거래세 0원, 수수료 적용. 상품별 소득세·분배금 자동
                            지급은 미반영.
                          </small>
                        )}
                        <details className="order-notes">
                          <summary>
                            매매 이유·투자 계획{" "}
                            <span className="optional">선택</span>
                          </summary>
                          <label>
                            매매 이유
                            <input
                              aria-label="매매 이유"
                              maxLength={300}
                              placeholder="이번 투자의 생각을 남겨보세요"
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                            />
                          </label>
                          <TradePlanFields
                            plan={tradePlan}
                            onChange={setTradePlan}
                          />
                        </details>
                        <OrderWeightPreview
                          account={account}
                          symbol={symbol}
                          side={side}
                          quantity={Number(quantity)}
                          price={
                            orderType === "market" &&
                            expectedFilled === Number(quantity)
                              ? expectedAmount / expectedFilled
                              : orderType === "limit"
                                ? orderPrice
                                : 0
                          }
                          mark={detail?.quote.price ?? 0}
                          feeBps={tradingCosts.commissionBps}
                          taxBps={selectedTaxBps}
                        />
                        <div className="order-submit-bar">
                          <div className="order-total">
                            <span>
                              {orderType === "market"
                                ? "호가 기준 예상 금액"
                                : "주문 예약 금액"}
                            </span>
                            <strong>
                              {won(
                                orderType === "market"
                                  ? expectedAmount
                                  : (orderPrice || 0) * (Number(quantity) || 0),
                              )}
                              <small> 원</small>
                            </strong>
                            <small>
                              예상 수수료 {won(expectedFee)}원
                              {side === "sell" &&
                                " · 예상 매도세 " + won(expectedTax) + "원"}
                            </small>
                          </div>
                          <button
                            className={"submit-order " + side}
                            disabled={
                              busy ||
                              !detail ||
                              !account ||
                              !!quantityError ||
                              !orderPrice ||
                              (provider === "kis" && !execution?.canTrade)
                            }
                            type="submit"
                          >
                            {busy
                              ? "처리 중…"
                              : (stock?.name || "") +
                                " " +
                                (side === "buy" ? "매수" : "매도")}
                          </button>
                        </div>
                        <details className="execution-model">
                          <summary>모의 잔량은 어떻게 계산하나요?</summary>
                          <p>
                            같은 호가를 다시 받아도 사용한 잔량은 중복 배분하지
                            않습니다. 관측한 누적 거래량이 늘면 증가 수량
                            범위에서 모의 사용 잔량을 복원합니다. 새 거래량이
                            없거나 확인되지 않으면 시간만으로 복원하지 않습니다.
                          </p>
                          <p>
                            실제 거래소의 주문 대기열과 신규 주문량을 재현한
                            값은 아닙니다. 일반 거래 상태가 확인될 때 가격·접수
                            순으로 배분합니다.
                          </p>
                        </details>
                        <p className="order-disclaimer">
                          상대 호가·잔량 기준 · 실시간 수신 시 체결
                          <br />
                          지정가 잔량은 대기 · 시장가 잔량은 자동 취소
                          <br />
                          예상 금액과 실제 체결은 다를 수 있습니다.
                          {provider === "demo"
                            ? " 미체결은 24시간 후 만료됩니다."
                            : " 미체결은 오늘 15:30에 만료됩니다."}
                        </p>
                      </form>
                    </section>
                  </div>
                  <section
                    className="panel trade-financials-panel"
                    id="trade-financials-panel"
                    role={isMobile ? "tabpanel" : undefined}
                    aria-labelledby={
                      isMobile ? "trade-financials-tab" : undefined
                    }
                    hidden={mobileTradeTab !== "financials"}
                  >
                    <StockFinancials
                      key={symbol}
                      symbol={symbol}
                      name={stock?.name || symbol}
                      instrument={stock?.instrument}
                      active={mobileTradeTab === "financials" && !!stock}
                    />
                  </section>
                </div>
                <section
                  className="panel stock-news-panel"
                  id="trade-news-panel"
                  role={isMobile ? "tabpanel" : undefined}
                  aria-labelledby={isMobile ? "trade-news-tab" : undefined}
                  hidden={
                    mobileTradeTab === "financials" ||
                    (isMobile && mobileTradeTab !== "news")
                  }
                >
                  <StockNews
                    key={symbol}
                    symbol={symbol}
                    name={stock?.name || symbol}
                    active={
                      (!isMobile && mobileTradeTab !== "financials") ||
                      mobileTradeTab === "news" ||
                      mobileTradeTab === "chart"
                    }
                    onData={setNewsData}
                    onChart={openNewsChart}
                    chartDate={
                      newsDateFilter?.symbol === symbol
                        ? newsDateFilter.day
                        : null
                    }
                    onClearDate={() => setNewsDateFilter(null)}
                  />
                </section>
              </div>
              {isMobile && (
                <dialog
                  className="stock-picker"
                  ref={stockPicker}
                  aria-labelledby="stock-picker-title"
                  onCancel={() => setStockPickerOpen(false)}
                  onClick={(event) => {
                    if (event.target === event.currentTarget)
                      setStockPickerOpen(false);
                  }}
                >
                  {stockExplorer}
                </dialog>
              )}
              <div className="bottom-grid">
                <section className="panel portfolio-panel">
                  <div className="panel-heading">
                    <div className="small-tabs large">
                      <button
                        className={tab === "holdings" ? "selected" : ""}
                        onClick={() => setTab("holdings")}
                      >
                        보유 종목 <span>{account?.holdings.length || 0}</span>
                      </button>
                      <button
                        className={tab === "orders" ? "selected" : ""}
                        onClick={() => setTab("orders")}
                      >
                        주문 내역{" "}
                        <span>
                          {pending.length ? pending.length + " 대기" : ""}
                        </span>
                      </button>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setPage("account")}
                    >
                      계좌 전체 보기 <ChevronRight size={14} />
                    </button>
                  </div>
                  {tab === "holdings" ? (
                    <Holdings account={account} onSelect={selectStock} />
                  ) : (
                    <Orders
                      account={account}
                      stocks={stocks}
                      onChanged={refresh}
                      onCancel={async (id) => {
                        try {
                          await api("/orders/" + id + "/cancel", {});
                          await refresh();
                          setToast("주문을 취소했습니다.");
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    />
                  )}
                </section>
              </div>
            </>
          )}
          {page === "account" && (
            <div className="account-workspace">
              <WorkspaceTabs
                id="account"
                label="계좌 보기"
                value={accountTab}
                onChange={setAccountTab}
                items={[
                  { key: "holdings", label: "보유 종목" },
                  { key: "pending", label: "미체결" },
                  { key: "orders", label: "체결 내역" },
                  { key: "performance", label: "성과·일지" },
                ]}
              />
              <div className="account-panels">
                {accountTab === "holdings" && (
                  <section
                    className="panel"
                    role="tabpanel"
                    id="account-panel-holdings"
                    aria-labelledby="account-tab-holdings"
                  >
                    <div className="panel-heading">
                      <h2>보유 종목</h2>
                      <span className="muted">
                        실현손익 {won(account?.realized || 0)}원 · 배당수익{" "}
                        {won(account?.dividends || 0)}원
                      </span>
                    </div>
                    <Holdings
                      account={account}
                      onSelect={(s) => {
                        selectStock(s);
                        setPage("trade");
                      }}
                    />
                  </section>
                )}
                {accountTab === "performance" && (
                  <div
                    className="account-panels"
                    role="tabpanel"
                    id="account-panel-performance"
                    aria-labelledby="account-tab-performance"
                  >
                    <PerformancePanel />
                    <section className="panel analytics-panel">
                      <div className="panel-heading">
                        <h2>투자 성과 분석</h2>
                        <span className="muted">
                          매도 주문별 실현손익 · 자동 평가 기록 기준
                        </span>
                      </div>
                      {analytics ? (
                        <div className="analytics-grid">
                          <div>
                            <small>매도 승률</small>
                            <b>
                              {analytics.winRate === null
                                ? "집계 전"
                                : pct(analytics.winRate)}
                            </b>
                            <span>{analytics.sellCount}건 매도</span>
                          </div>
                          <div>
                            <small>평균 실현손익</small>
                            <b
                              className={
                                (analytics.averagePnl || 0) < 0 ? "down" : "up"
                              }
                            >
                              {analytics.averagePnl === null
                                ? "—"
                                : won(analytics.averagePnl) + "원"}
                            </b>
                            <span>매도 주문당</span>
                          </div>
                          <div>
                            <small>손익비</small>
                            <b>
                              {analytics.profitFactor === null
                                ? "손실 없음"
                                : analytics.profitFactor.toFixed(2)}
                            </b>
                            <span>총이익 ÷ 총손실</span>
                          </div>
                          <div>
                            <small>최대 낙폭</small>
                            <b className="down">
                              {analytics.maxDrawdown === null
                                ? "수집 중"
                                : pct(analytics.maxDrawdown)}
                            </b>
                            <span>{analytics.snapshotCount}개 평가 기록</span>
                          </div>
                          <div>
                            <small>누적 거래비용</small>
                            <b>{won(analytics.fees + analytics.taxes)}원</b>
                            <span>
                              수수료 {won(analytics.fees)} · 세금{" "}
                              {won(analytics.taxes)}
                            </span>
                          </div>
                          <div>
                            <small>매매 이유 작성률</small>
                            <b>
                              {analytics.noteRate === null
                                ? "—"
                                : pct(analytics.noteRate)}
                            </b>
                            <span>전체 {analytics.orderCount}개 주문</span>
                          </div>
                        </div>
                      ) : (
                        <div className="empty">
                          투자 기록을 분석하고 있습니다.
                        </div>
                      )}
                    </section>
                    <JournalPanel stocks={stocks} />
                    <PortfolioRiskPanel
                      account={account}
                      stocks={stocks}
                      themes={themeCatalog?.themes ?? []}
                      themesAvailable={themeCatalog !== null}
                    />
                  </div>
                )}
                {(accountTab === "pending" || accountTab === "orders") && (
                  <section
                    className="panel order-history-panel"
                    role="tabpanel"
                    id={"account-panel-" + accountTab}
                    aria-labelledby={"account-tab-" + accountTab}
                  >
                    <div className="panel-heading">
                      <h2>
                        {accountTab === "pending"
                          ? "미체결 주문"
                          : "주문 · 체결 내역"}
                      </h2>
                      <span className="muted">
                        {accountTab === "pending"
                          ? "정정·취소 가능"
                          : "체결·취소·만료 · 최근 200건 기준"}
                      </span>
                    </div>
                    <Orders
                      key={accountTab}
                      emptyTitle={
                        accountTab === "pending"
                          ? "현재 미체결 주문이 없어요"
                          : "아직 체결·종료된 주문이 없어요"
                      }
                      account={
                        account
                          ? {
                              ...account,
                              orders: account.orders.filter((order) =>
                                accountTab === "pending"
                                  ? order.status === "pending"
                                  : order.status !== "pending",
                              ),
                            }
                          : null
                      }
                      stocks={stocks}
                      onChanged={refresh}
                      onCancel={async (id) => {
                        try {
                          await api("/orders/" + id + "/cancel", {});
                          await refresh();
                          setToast("주문을 취소했습니다.");
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    />
                  </section>
                )}
              </div>
            </div>
          )}
          {page === "admin" && (
            <div className="admin-grid">
              <section className="panel competition-admin">
                <div className="panel-heading">
                  <h2>
                    <Trophy size={18} /> 모의투자 대회 관리
                  </h2>
                  <span className="muted">KOSPI 벤치마크 · 전원 자동 참가</span>
                </div>
                <form onSubmit={createCompetition}>
                  <label>
                    대회명
                    <input
                      aria-label="대회명"
                      maxLength={60}
                      value={competitionName}
                      onChange={(e) => setCompetitionName(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    종료일
                    <input
                      aria-label="대회 종료일"
                      type="date"
                      min={new Date(Date.now() + 9 * 3600000)
                        .toISOString()
                        .slice(0, 10)}
                      value={competitionEndDate}
                      onChange={(e) => setCompetitionEndDate(e.target.value)}
                      required
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      competitions.some(
                        (item) =>
                          item.status === "active" ||
                          item.status === "finalizing",
                      )
                    }
                  >
                    {busy
                      ? "시작 중…"
                      : competitions.some(
                            (item) =>
                              item.status === "active" ||
                              item.status === "finalizing",
                          )
                        ? "진행 중인 대회가 있습니다"
                        : "지금 대회 시작"}
                  </button>
                  <p className="order-disclaimer">
                    시작 즉시 현재 멤버 전원의 평가자산과 KOSPI를 기준값으로
                    저장합니다. 종료일 15:30(KST)에 최종 성과를 확정합니다.
                  </p>
                </form>
                {competitions.length > 0 && (
                  <div className="table-wrap competition-history">
                    <table
                      className="responsive-table"
                      aria-label="대회 관리 목록"
                      role="table"
                    >
                      <thead role="rowgroup">
                        <tr role="row">
                          <th scope="col" role="columnheader">
                            대회
                          </th>
                          <th scope="col" role="columnheader">
                            상태
                          </th>
                          <th scope="col" role="columnheader">
                            기간
                          </th>
                          <th scope="col" role="columnheader">
                            참가
                          </th>
                          <th scope="col" role="columnheader">
                            KOSPI
                          </th>
                          <th scope="col" role="columnheader">
                            관리
                          </th>
                        </tr>
                      </thead>
                      <tbody role="rowgroup">
                        {competitions.map((item) => (
                          <tr role="row" key={item.id}>
                            <td role="cell" data-label="대회">
                              <b>{item.name}</b>
                            </td>
                            <td role="cell" data-label="상태">
                              {item.status === "active"
                                ? "진행 중"
                                : item.status === "finalizing"
                                  ? "종료 집계 중"
                                  : item.status === "cancelled"
                                    ? "취소"
                                    : "종료"}
                              {item.status === "cancelled" &&
                                item.cancel_reason && (
                                  <small>{item.cancel_reason}</small>
                                )}
                            </td>
                            <td role="cell" data-label="기간">
                              {date(new Date(item.starts_at).toISOString())} ~{" "}
                              {date(new Date(item.ends_at).toISOString())}
                            </td>
                            <td role="cell" data-label="참가">
                              {item.participant_count}명
                            </td>
                            <td role="cell" data-label="KOSPI">
                              {item.status === "cancelled"
                                ? "—"
                                : item.benchmark_rate === null
                                  ? "진행 중"
                                  : pct(item.benchmark_rate)}
                            </td>
                            <td role="cell" data-label="관리">
                              {item.status === "active" ? (
                                <button
                                  type="button"
                                  className="danger-button"
                                  disabled={busy}
                                  onClick={() => void cancelCompetition(item)}
                                >
                                  대회 취소
                                </button>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <section className="panel grant-panel">
                <div className="panel-heading">
                  <h2>
                    <Plus size={18} /> 가상 투자금 지급
                  </h2>
                </div>
                <form onSubmit={grant}>
                  <label>
                    지급 대상
                    <select
                      aria-label="지급 대상"
                      required
                      value={grantUser}
                      onChange={(e) => setGrantUser(e.target.value)}
                    >
                      <option value="">멤버를 선택하세요</option>
                      {members.map((m) => (
                        <option value={m.id} key={m.id}>
                          {m.name} (@{m.username})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    지급 금액 (원)
                    <input
                      aria-label="지급 금액"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="1000000000"
                      step="1"
                      required
                      value={grantAmount}
                      onChange={(e) => setGrantAmount(e.target.value)}
                    />
                  </label>
                  <div className="quantity-shortcuts">
                    {[1000000, 10000000, 100000000].map((n) => (
                      <button
                        type="button"
                        key={n}
                        onClick={() => setGrantAmount(String(n))}
                      >
                        {won(n / 10000)}만 원
                      </button>
                    ))}
                  </div>
                  <label>
                    지급 사유
                    <input
                      aria-label="지급 사유"
                      maxLength={200}
                      required
                      value={grantNote}
                      onChange={(e) => setGrantNote(e.target.value)}
                    />
                  </label>
                  <button className="primary" disabled={busy || !grantUser}>
                    {busy ? "지급 중…" : "가상 투자금 지급"}
                  </button>
                  <p className="order-disclaimer">
                    지급 내역은 기록으로 남습니다.
                    <br />
                    추가 지급액은 투자 수익에 포함되지 않습니다.
                  </p>
                </form>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>스터디 멤버</h2>
                  <span className="muted">{members.length}명</span>
                </div>
                <div className="table-wrap">
                  <table
                    className="responsive-table"
                    aria-label="멤버 현황"
                    role="table"
                  >
                    <thead role="rowgroup">
                      <tr role="row">
                        <th scope="col" role="columnheader">
                          멤버
                        </th>
                        <th scope="col" role="columnheader">
                          역할
                        </th>
                        <th scope="col" role="columnheader">
                          주문 가능
                        </th>
                        <th scope="col" role="columnheader">
                          평가자산
                        </th>
                        <th scope="col" role="columnheader">
                          투자손익
                        </th>
                        <th scope="col" role="columnheader">
                          누적 지급액
                        </th>
                      </tr>
                    </thead>
                    <tbody role="rowgroup">
                      {members.map((m) => (
                        <tr role="row" key={m.id}>
                          <td role="cell" data-label="멤버">
                            <b>{m.name}</b>
                            <small>@{m.username}</small>
                          </td>
                          <td role="cell" data-label="역할">
                            {m.role === "admin" ? "관리자" : "멤버"}
                          </td>
                          <td role="cell" data-label="주문 가능">
                            {won(m.available)}원
                          </td>
                          <td role="cell" data-label="평가자산">
                            {m.assets === null
                              ? "시세 확인 필요"
                              : won(m.assets) + "원"}
                          </td>
                          <td
                            role="cell"
                            data-label="투자손익"
                            className={
                              m.profit !== null && m.profit < 0 ? "down" : "up"
                            }
                          >
                            {m.profit === null
                              ? "—"
                              : (m.profit > 0 ? "+" : "") +
                                won(m.profit) +
                                "원"}
                          </td>
                          <td role="cell" data-label="누적 지급액">
                            {won(m.deposits)}원
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="panel market-monitor">
                <div className="panel-heading">
                  <h2>시세 연결 상태</h2>
                  <span
                    className={
                      marketStatus?.realtime.connected ? "mint" : "muted"
                    }
                  >
                    {marketStatus?.realtime.status || "확인 중"}
                  </span>
                </div>
                {marketStatus && (
                  <div className="monitor-grid">
                    <div>
                      <small>REST 요청</small>
                      <b>{won(marketStatus.rest.requests)}회</b>
                    </div>
                    <div>
                      <small>성공 / 실패</small>
                      <b>
                        {won(marketStatus.rest.successes)} /{" "}
                        {won(marketStatus.rest.failures)}
                      </b>
                    </div>
                    <div>
                      <small>최근 응답시간</small>
                      <b>
                        {marketStatus.rest.lastLatencyMs === null
                          ? "—"
                          : won(marketStatus.rest.lastLatencyMs) + "ms"}
                      </b>
                    </div>
                    <div>
                      <small>실시간 구독</small>
                      <b>
                        {marketStatus.realtime.subscribedSymbols} /{" "}
                        {marketStatus.realtime.wantedSymbols}종목
                      </b>
                    </div>
                    <div>
                      <small>마지막 REST 성공</small>
                      <b>
                        {marketStatus.rest.lastSuccessAt
                          ? date(
                              new Date(
                                marketStatus.rest.lastSuccessAt,
                              ).toISOString(),
                            )
                          : "—"}
                      </b>
                    </div>
                    <div>
                      <small>마지막 실시간 수신</small>
                      <b>
                        {marketStatus.realtime.lastMessageAt
                          ? date(
                              new Date(
                                marketStatus.realtime.lastMessageAt,
                              ).toISOString(),
                            )
                          : "—"}
                      </b>
                    </div>
                    {marketStatus.rest.lastError && (
                      <p role="alert">
                        최근 오류: {marketStatus.rest.lastError}
                      </p>
                    )}
                  </div>
                )}
              </section>
              <section className="panel corporate-action">
                <div className="panel-heading">
                  <h2>기업행사 반영</h2>
                  <span className="muted">
                    관리자 전용 · 실행 전 반드시 확인
                  </span>
                </div>
                <form onSubmit={applyCorporateAction}>
                  <label>
                    종목코드
                    <input
                      aria-label="기업행사 종목코드"
                      value={actionSymbol}
                      pattern="[A-Z0-9]{6}"
                      maxLength={6}
                      onChange={(e) =>
                        setActionSymbol(e.target.value.toUpperCase())
                      }
                      required
                    />
                  </label>
                  <label>
                    행사 유형
                    <select
                      value={actionType}
                      onChange={(e) =>
                        setActionType(e.target.value as "dividend" | "split")
                      }
                    >
                      <option value="dividend">현금배당</option>
                      <option value="split">주식분할·병합</option>
                    </select>
                  </label>
                  {actionType === "dividend" ? (
                    <label>
                      주당 배당금
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max="10000000"
                        value={actionAmount}
                        onChange={(e) => setActionAmount(e.target.value)}
                        required
                      />
                    </label>
                  ) : (
                    <div className="action-ratio">
                      <label>
                        변경 후
                        <input
                          type="number"
                          inputMode="numeric"
                          min="1"
                          max="1000"
                          value={actionNumerator}
                          onChange={(e) => setActionNumerator(e.target.value)}
                          required
                        />
                      </label>
                      <span>:</span>
                      <label>
                        변경 전
                        <input
                          type="number"
                          inputMode="numeric"
                          min="1"
                          max="1000"
                          value={actionDenominator}
                          onChange={(e) => setActionDenominator(e.target.value)}
                          required
                        />
                      </label>
                    </div>
                  )}
                  <label>
                    기준일
                    <input
                      type="date"
                      value={actionDate}
                      onChange={(e) => setActionDate(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    메모
                    <input
                      maxLength={200}
                      value={actionNote}
                      onChange={(e) => setActionNote(e.target.value)}
                      required
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    {busy ? "반영 중…" : "기업행사 적용"}
                  </button>
                  <p className="order-disclaimer">
                    분할 시 해당 종목의 미체결 주문이 취소됩니다. 단주가
                    발생하는 병합은 적용되지 않습니다.
                  </p>
                </form>
              </section>
              <section className="panel corporate-history">
                <div className="panel-heading">
                  <h2>기업행사 기록</h2>
                </div>
                {corporateActions.length ? (
                  <div className="table-wrap">
                    <table
                      className="responsive-table"
                      aria-label="기업행사 기록"
                      role="table"
                    >
                      <thead role="rowgroup">
                        <tr role="row">
                          <th scope="col" role="columnheader">
                            기준일
                          </th>
                          <th scope="col" role="columnheader">
                            종목
                          </th>
                          <th scope="col" role="columnheader">
                            유형
                          </th>
                          <th scope="col" role="columnheader">
                            내용
                          </th>
                          <th scope="col" role="columnheader">
                            메모
                          </th>
                        </tr>
                      </thead>
                      <tbody role="rowgroup">
                        {corporateActions.map((action) => (
                          <tr role="row" key={action.id}>
                            <td role="cell" data-label="기준일">
                              {action.effective_date}
                            </td>
                            <td role="cell" data-label="종목">
                              {action.symbol}
                            </td>
                            <td role="cell" data-label="유형">
                              {action.type === "dividend" ? "배당" : "분할"}
                            </td>
                            <td role="cell" data-label="내용">
                              {action.type === "dividend"
                                ? "주당 " +
                                  won(action.cash_per_share || 0) +
                                  "원"
                                : action.numerator + ":" + action.denominator}
                            </td>
                            <td role="cell" data-label="메모">
                              {action.note}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">아직 기업행사 기록이 없습니다.</div>
                )}
              </section>
              <section className="panel grant-history">
                <div className="panel-heading">
                  <h2>투자금 지급 기록</h2>
                </div>
                {grants.length ? (
                  <div className="table-wrap">
                    <table
                      className="responsive-table"
                      aria-label="투자금 지급 기록"
                      role="table"
                    >
                      <thead role="rowgroup">
                        <tr role="row">
                          <th scope="col" role="columnheader">
                            지급일시
                          </th>
                          <th scope="col" role="columnheader">
                            받은 멤버
                          </th>
                          <th scope="col" role="columnheader">
                            금액
                          </th>
                          <th scope="col" role="columnheader">
                            사유
                          </th>
                        </tr>
                      </thead>
                      <tbody role="rowgroup">
                        {grants.map((g) => (
                          <tr role="row" key={g.id}>
                            <td role="cell" data-label="지급일시">
                              {date(g.created_at)}
                            </td>
                            <td role="cell" data-label="받은 멤버">
                              {g.name}
                            </td>
                            <td role="cell" data-label="금액" className="mint">
                              +{won(g.amount)}원
                            </td>
                            <td role="cell" data-label="사유">
                              {g.note}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">아직 지급 내역이 없습니다.</div>
                )}
              </section>
            </div>
          )}
          {page === "ranking" && (
            <section className="panel competition-ranking">
              <div className="panel-heading">
                <h2>
                  <Trophy size={18} /> 모의투자 대회 랭킹
                </h2>
                <div className="ranking-actions">
                  {competitions.length > 0 && (
                    <select
                      aria-label="대회 선택"
                      value={competition?.id || ""}
                      onChange={(e) =>
                        refreshRanking(Number(e.target.value)).catch((error) =>
                          setError(error.message),
                        )
                      }
                    >
                      {competitions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className="text-button"
                    onClick={() =>
                      refreshRanking(competition?.id).catch((e) =>
                        setError(e.message),
                      )
                    }
                  >
                    <RefreshCw size={14} /> 새로고침
                  </button>
                </div>
              </div>
              {competition ? (
                <>
                  <div className="competition-overview">
                    <div>
                      <small>대회 상태</small>
                      <b>
                        {competition.status === "active"
                          ? "진행 중"
                          : competition.status === "finalizing"
                            ? "종료 집계 중"
                            : competition.status === "cancelled"
                              ? "취소"
                              : "종료"}
                      </b>
                      <span>
                        {date(new Date(competition.starts_at).toISOString())} ~{" "}
                        {date(new Date(competition.ends_at).toISOString())}
                      </span>
                    </div>
                    <div>
                      <small>KOSPI 벤치마크</small>
                      <b
                        className={
                          (competition.benchmark_rate || 0) < 0 ? "down" : "up"
                        }
                      >
                        {competition.status === "cancelled"
                          ? "집계 안 함"
                          : competition.benchmark_rate === null
                            ? "조회 중"
                            : pct(competition.benchmark_rate)}
                      </b>
                      <span>
                        시작 {competition.benchmark_start.toFixed(2)}
                        {competition.status === "cancelled"
                          ? " · 대회 취소"
                          : competition.benchmark_end !== null
                            ? " · 종료 " + competition.benchmark_end.toFixed(2)
                            : " · 실시간 비교"}
                      </span>
                    </div>
                    <div>
                      <small>참가자</small>
                      <b>{competition.participant_count}명</b>
                      <span>대회 시작 시 자동 참가</span>
                    </div>
                  </div>
                  {competition.status === "cancelled" ? (
                    <div className="empty competition-cancelled">
                      취소된 대회입니다. 순위와 KOSPI 비교는 집계하지 않습니다.
                      {competition.cancel_reason && (
                        <small>취소 사유: {competition.cancel_reason}</small>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="table-wrap">
                        <table
                          className="responsive-table"
                          aria-label="대회 랭킹"
                          role="table"
                        >
                          <thead role="rowgroup">
                            <tr role="row">
                              <th scope="col" role="columnheader">
                                순위
                              </th>
                              <th scope="col" role="columnheader">
                                멤버
                              </th>
                              <th scope="col" role="columnheader">
                                시작자산
                              </th>
                              <th scope="col" role="columnheader">
                                평가자산
                              </th>
                              <th scope="col" role="columnheader">
                                추가지급 제외
                              </th>
                              <th scope="col" role="columnheader">
                                대회 수익률
                              </th>
                              <th scope="col" role="columnheader">
                                KOSPI 대비
                              </th>
                            </tr>
                          </thead>
                          <tbody role="rowgroup">
                            {ranking.map((row, i) => (
                              <tr role="row" key={row.id}>
                                <td role="cell" data-label="순위">
                                  <span
                                    className={
                                      "rank " +
                                      (i === 0 && row.rate !== null
                                        ? "first"
                                        : "")
                                    }
                                  >
                                    {row.rate === null ? "—" : i + 1}
                                  </span>
                                </td>
                                <td role="cell" data-label="멤버">
                                  <b>{row.name}</b>
                                  {row.id === user.id && (
                                    <span className="me-tag">나</span>
                                  )}
                                </td>
                                <td role="cell" data-label="시작자산">
                                  {won(row.startingAssets)}원
                                </td>
                                <td role="cell" data-label="평가자산">
                                  {row.assets === null
                                    ? "시세 확인 필요"
                                    : won(row.assets) + "원"}
                                </td>
                                <td role="cell" data-label="추가지급 제외">
                                  {row.netGrants > 0
                                    ? won(row.netGrants) + "원"
                                    : "—"}
                                </td>
                                <td
                                  role="cell"
                                  data-label="대회 수익률"
                                  className={
                                    row.rate !== null && row.rate < 0
                                      ? "down"
                                      : "up"
                                  }
                                >
                                  {row.rate === null
                                    ? "집계 전"
                                    : pct(row.rate)}
                                </td>
                                <td
                                  role="cell"
                                  data-label="KOSPI 대비"
                                  className={
                                    row.excessRate !== null &&
                                    row.excessRate < 0
                                      ? "down"
                                      : "up"
                                  }
                                >
                                  {row.excessRate === null
                                    ? "집계 전"
                                    : pct(row.excessRate)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="ranking-note">
                        대회 수익률은 시작 평가자산을 기준으로 계산하며, 대회 중
                        추가로 지급된 가상 투자금은 성과에서 제외합니다. KOSPI
                        대비는 같은 기간 KOSPI 수익률을 뺀 초과수익률입니다.
                      </p>
                    </>
                  )}
                </>
              ) : (
                <div className="empty">
                  아직 시작된 대회가 없습니다. 관리자가 대회를 시작하면 전원이
                  자동 참가합니다.
                </div>
              )}
            </section>
          )}
          <footer className="footer">
            <span>아미콤 · 함께 배우는 투자</span>
            <span>가상 자산으로 진행되는 스터디 모의투자 서비스</span>
          </footer>
        </div>
      </main>
      {chartExpanded && (
        <AdvancedChart
          key={
            user.id +
            ":" +
            symbol +
            ":" +
            period +
            ":" +
            (activeChartView?.id ?? "latest")
          }
          bars={
            detail?.chartPeriod === period && detail.quote.symbol === symbol
              ? detail.candles
              : []
          }
          initialWindow={activeChartView?.window}
          symbol={symbol}
          name={stock?.name ?? symbol}
          userId={user.id}
          period={period}
          onPeriod={(next, window) => {
            setChartView(
              window
                ? {
                    id: crypto.randomUUID(),
                    userId: user.id,
                    symbol,
                    period: next,
                    window,
                  }
                : null,
            );
            if (next !== period) setDetail(null);
            setPeriod(next);
          }}
          onClose={() => {
            setChartExpanded(false);
            setChartView(null);
          }}
          error={detailError}
          source={provider}
        />
      )}
      {toast && (
        <div role="status" className="toast">
          <ShieldCheck size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
function StockThemeTags({
  themes,
  onSelect,
}: {
  themes: StockTheme[];
  onSelect: (code: string) => void;
}) {
  return (
    <details className="selected-stock-themes">
      <summary>
        {themes.length ? "관련 테마 " + themes.length + "개" : "테마 미분류"}
      </summary>
      {themes.length ? (
        <div className="theme-tags">
          {themes.map((theme) => (
            <button
              key={theme.code}
              type="button"
              onClick={() => onSelect(theme.code)}
            >
              {theme.name}
            </button>
          ))}
        </div>
      ) : (
        <p>현재 제공된 테마 분류에 등록되지 않은 종목입니다.</p>
      )}
    </details>
  );
}
function Summary({
  title,
  value,
  unit,
  sub,
  color = "",
  icon,
}: {
  title: string;
  value: string;
  unit: string;
  sub: string;
  color?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="summary-card">
      <div className="summary-title">
        {title}
        <span>{icon}</span>
      </div>
      <div className={"summary-value " + color}>
        {value}
        <small>{unit}</small>
      </div>
      <p>{sub}</p>
    </div>
  );
}
function Holdings({
  account,
  onSelect,
}: {
  account: Account | null;
  onSelect: (s: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const detailsId = useId();
  if (!account?.holdings.length)
    return (
      <div className="empty">
        <Wallet size={28} />
        <strong>첫 투자를 시작해보세요</strong>
        <span>지급받은 가상 투자금으로 종목을 매수하면 여기에 표시됩니다.</span>
      </div>
    );
  return (
    <div className="table-wrap">
      <table className="responsive-table" aria-label="보유 종목" role="table">
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              종목
            </th>
            <th scope="col" role="columnheader" className="mobile-only">
              평가금액
            </th>
            <th scope="col" role="columnheader">
              보유 수량
            </th>
            <th scope="col" role="columnheader">
              평균 매수가
            </th>
            <th scope="col" role="columnheader">
              현재가
            </th>
            <th scope="col" role="columnheader">
              평가손익
            </th>
            <th scope="col" role="columnheader" className="mobile-only">
              상세
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {account.holdings.map((h) => {
            const pl = h.price === null ? null : h.quantity * h.price - h.cost;
            return (
              <tr
                role="row"
                key={h.symbol}
                className={
                  "record-row " + (expanded.has(h.symbol) ? "is-expanded" : "")
                }
              >
                <td role="cell" data-label="종목">
                  <div className="holding-stock">
                    <StockLogo symbol={h.symbol} name={h.name} size="sm" />
                    <span>
                      <button
                        className="table-link"
                        onClick={() => onSelect(h.symbol)}
                      >
                        {h.name}
                      </button>
                      <small>
                        {h.symbol}
                        {h.instrument === "etf" && " · ETF"}
                      </small>
                    </span>
                  </div>
                </td>
                <td role="cell" data-label="평가금액" className="mobile-only">
                  {h.price === null
                    ? "시세 확인 필요"
                    : won(h.quantity * h.price) + "원"}
                </td>
                <td
                  role="cell"
                  data-label="보유 수량"
                  className="record-detail"
                  id={detailsId + h.symbol + "-quantity"}
                >
                  {won(h.quantity)}주
                  {h.reserved > 0 && <small>예약 {h.reserved}주</small>}
                </td>
                <td
                  role="cell"
                  data-label="평균 매수가"
                  className="record-detail"
                  id={detailsId + h.symbol + "-cost"}
                >
                  {won(h.cost / h.quantity)}원
                </td>
                <td
                  role="cell"
                  data-label="현재가"
                  className="record-detail"
                  id={detailsId + h.symbol + "-price"}
                >
                  {h.price === null ? "—" : won(h.price) + "원"}
                </td>
                <td
                  role="cell"
                  data-label="평가손익"
                  className={pl !== null && pl < 0 ? "down" : "up"}
                >
                  {pl === null
                    ? "시세 확인 필요"
                    : (pl > 0 ? "+" : "") + won(pl) + "원"}
                  {pl !== null && <small>{pct((pl / h.cost) * 100)}</small>}
                </td>
                <td role="cell" className="mobile-only record-toggle-cell">
                  <button
                    type="button"
                    className="record-toggle"
                    aria-label={h.name + " 보유 상세"}
                    aria-expanded={expanded.has(h.symbol)}
                    aria-controls={["quantity", "cost", "price"]
                      .map((part) => detailsId + h.symbol + "-" + part)
                      .join(" ")}
                    onClick={() =>
                      setExpanded((previous) => {
                        const next = new Set(previous);
                        if (next.has(h.symbol)) next.delete(h.symbol);
                        else next.add(h.symbol);
                        return next;
                      })
                    }
                  >
                    {expanded.has(h.symbol) ? "상세 접기" : "보유 상세 보기"}
                    <ChevronRight size={16} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function Orders({
  account,
  stocks,
  onCancel,
  onChanged,
  emptyTitle = "아직 주문 내역이 없어요",
}: {
  account: Account | null;
  stocks: Stock[];
  onCancel: (id: number) => Promise<void>;
  onChanged: () => Promise<void>;
  emptyTitle?: string;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const detailsId = useId();
  const isMobile = useMobile();
  const amendForm = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState<Account["orders"][number] | null>(
    null,
  );
  const [editPrice, setEditPrice] = useState(""),
    [editQty, setEditQty] = useState(""),
    [editError, setEditError] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    if (editing && isMobile) {
      amendForm.current?.scrollIntoView({
        block: "center",
        behavior: "instant",
      });
      amendForm.current?.querySelector("input")?.focus({ preventScroll: true });
    }
  }, [editing?.id, isMobile]);
  const request = useRef<string | null>(null);
  async function amend(e: FormEvent) {
    e.preventDefault();
    if (!editing || saving) return;
    setSaving(true);
    setEditError("");
    try {
      request.current ??= crypto.randomUUID();
      await api("/orders/" + editing.id + "/amend", {
        limitPrice: Number(editPrice),
        quantity: Number(editQty),
        expectedFilled: editing.filled_quantity,
        requestId: request.current,
      });
      setEditing(null);
      request.current = null;
      await onChanged();
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const [cancelling, setCancelling] = useState<number | null>(null);
  if (!account?.orders.length)
    return (
      <div className="empty">
        <Clock3 size={28} />
        <strong>{emptyTitle}</strong>
        <span>매수·매도 주문과 체결 기록을 확인할 수 있습니다.</span>
      </div>
    );
  return (
    <div className="table-wrap">
      {editing && (
        <form className="amend-form" ref={amendForm} onSubmit={amend}>
          <strong>
            미체결 주문 정정 ·{" "}
            {stocks.find((s) => s.symbol === editing.symbol)?.name ||
              editing.symbol}
          </strong>
          <label>
            정정 가격
            <input
              aria-label="정정 가격"
              type="number"
              inputMode="numeric"
              min={tickSize(Number(editPrice), editing.instrument)}
              step={tickSize(Number(editPrice), editing.instrument)}
              value={editPrice}
              onChange={(e) => {
                setEditPrice(e.target.value);
                request.current = null;
              }}
              required
            />
          </label>
          <label>
            정정 수량
            <input
              aria-label="정정 수량"
              type="number"
              inputMode="numeric"
              min="1"
              max={editing.quantity - editing.filled_quantity}
              value={editQty}
              onChange={(e) => {
                setEditQty(e.target.value);
                request.current = null;
              }}
              required
            />
          </label>
          <small>
            기존 체결은 유지됩니다. 남은 주문을 취소하고 새 순서로 접수합니다.
          </small>
          {editError && <p role="alert">{editError}</p>}
          <button type="submit" disabled={saving}>
            {saving ? "처리 중…" : "정정 접수"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => setEditing(null)}
          >
            닫기
          </button>
        </form>
      )}
      <table className="responsive-table" aria-label="주문 내역" role="table">
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              주문일시 / 종목
            </th>
            <th scope="col" role="columnheader">
              구분
            </th>
            <th scope="col" role="columnheader">
              수량 / 가격
            </th>
            <th scope="col" role="columnheader">
              상태
            </th>
            <th scope="col" role="columnheader">
              매매 이유
            </th>
            <th scope="col" role="columnheader" className="mobile-only">
              상세
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {account.orders.map((o) => (
            <tr
              role="row"
              key={o.id}
              className={
                "record-row " + (expanded.has(o.id) ? "is-expanded" : "")
              }
            >
              <td role="cell" data-label="주문일시 / 종목">
                <b>
                  {stocks.find((s) => s.symbol === o.symbol)?.name || o.symbol}
                </b>
                <small className="record-detail">{date(o.created_at)}</small>
              </td>
              <td
                role="cell"
                data-label="구분"
                className={o.side === "buy" ? "up" : "down"}
              >
                {o.side === "buy" ? "매수" : "매도"}
                <small>{o.type === "market" ? "시장가" : "지정가"}</small>
              </td>
              <td role="cell" data-label="수량 / 가격">
                {won(o.quantity)}주{" "}
                <small>
                  체결 {won(o.filled_quantity)}주 /{" "}
                  {o.status === "cancelled" ? "취소" : "미체결"}{" "}
                  {won(o.quantity - o.filled_quantity)}주
                </small>
                <small>
                  {o.fill_price
                    ? "평균 " + won(o.fill_price)
                    : o.limit_price
                      ? won(o.limit_price)
                      : "시장가"}
                  원
                </small>
                {o.filled_quantity > 0 && (
                  <small className="record-detail">
                    수수료 {won(o.fee || 0)}원
                    {o.side === "sell" && " · 매도세 " + won(o.tax || 0) + "원"}
                  </small>
                )}
              </td>
              <td role="cell" data-label="상태">
                <progress
                  aria-label={"주문 " + o.id + " 체결 진행률"}
                  max={o.quantity}
                  value={o.filled_quantity}
                />
                <span className={"order-status " + o.status}>
                  {
                    {
                      filled: "체결",
                      pending: o.filled_quantity > 0 ? "부분 체결" : "대기",
                      cancelled: o.filled_quantity > 0 ? "잔량 취소" : "취소",
                    }[o.status]
                  }
                </span>
                {o.cancel_reason && (
                  <small className="record-detail">{o.cancel_reason}</small>
                )}
                {o.replaces_id && (
                  <small className="record-detail">
                    주문 #{o.replaces_id} 정정
                  </small>
                )}
                {o.expires_at && o.status === "pending" && (
                  <small className="record-detail">
                    {date(new Date(o.expires_at).toISOString())} 만료
                  </small>
                )}
                {o.status === "pending" && o.type === "limit" && (
                  <button
                    className="cancel-button"
                    onClick={() => {
                      setEditing(o);
                      setEditPrice(String(o.limit_price));
                      setEditQty(String(o.quantity - o.filled_quantity));
                      setEditError("");
                      request.current = null;
                    }}
                  >
                    정정
                  </button>
                )}
                {o.status === "pending" && (
                  <button
                    className="cancel-button"
                    disabled={cancelling === o.id}
                    onClick={async () => {
                      setCancelling(o.id);
                      try {
                        await onCancel(o.id);
                      } finally {
                        setCancelling(null);
                      }
                    }}
                  >
                    취소
                  </button>
                )}
              </td>
              <td
                role="cell"
                data-label="매매 이유"
                className="note-cell record-detail"
                id={detailsId + o.id + "-details"}
              >
                {o.note || "—"}
                {o.execution_reason && (
                  <p className="execution-reason">{o.execution_reason}</p>
                )}
                {!!o.fills?.length && (
                  <details className="fill-details">
                    <summary>체결 상세 ({o.fills.length})</summary>
                    {o.fills.map((f) => (
                      <div key={f.id}>
                        <small>
                          {date(f.created_at)} · {won(f.price)}원 ×{" "}
                          {won(f.quantity)}주 · 비용{" "}
                          {won((f.fee || 0) + (f.tax || 0))}원
                        </small>
                        <FillEvidence fill={f} />
                      </div>
                    ))}
                  </details>
                )}
              </td>
              <td role="cell" className="mobile-only record-toggle-cell">
                <button
                  type="button"
                  className="record-toggle"
                  aria-label={"주문 " + o.id + " 상세"}
                  aria-expanded={expanded.has(o.id)}
                  aria-controls={detailsId + o.id + "-details"}
                  onClick={() =>
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      if (next.has(o.id)) next.delete(o.id);
                      else next.add(o.id);
                      return next;
                    })
                  }
                >
                  {expanded.has(o.id) ? "상세 접기" : "주문 상세 보기"}
                  <ChevronRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Login({
  onLogin,
  provider,
}: {
  onLogin: (user: User) => void;
  provider: string;
}) {
  const [register, setRegister] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const d = await api<{ user: User }>(
        register ? "/register" : "/login",
        Object.fromEntries(f),
      );
      onLogin(d.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-story">
        <div className="brand">
          <BrandLogo />
          아미콤
        </div>
        <div className="login-copy">
          <span className="eyebrow">INVEST IN YOUR LEARNING</span>
          <h1>
            투자의 시작,
            <br />
            함께라서 더 단단하게.
          </h1>
          <p>
            시장을 관찰하고, 나만의 판단을 기록하세요.
            <br />
            아미콤과 함께하는 우리만의 투자실.
          </p>
          <div className="login-art">
            <div className="art-grid" />
            {[
              28, 44, 35, 58, 48, 68, 61, 83, 74, 100, 88, 118, 105, 132, 120,
              151, 137, 173,
            ].map((h, i) => (
              <div
                className={"art-candle " + (i % 3 === 1 ? "negative" : "")}
                key={i}
                style={{
                  height: 35 + (i % 4) * 13,
                  bottom: h,
                  left: 20 + i * 23,
                }}
              />
            ))}
            <span className="art-label">
              <ArrowUpRight size={16} /> LEARN. TRADE. GROW.
            </span>
          </div>
        </div>
        <span className="login-bottom">가상 자산으로 쌓는 진짜 투자 경험</span>
      </div>
      <div className="login-form-wrap">
        <div className="login-form">
          <span className="login-badge">
            <GraduationCap size={16} /> STUDY WORKSPACE
          </span>
          <h2>{register ? "스터디에 함께하세요" : "반가워요, 투자자님"}</h2>
          <p>
            {register
              ? "초대 코드로 스터디에 가입할 수 있어요."
              : "로그인하고 오늘의 투자를 시작하세요."}
          </p>
          <form onSubmit={submit}>
            {register && (
              <label>
                이름
                <input
                  name="name"
                  autoComplete="name"
                  placeholder="스터디에서 사용할 이름"
                  required
                  maxLength={30}
                />
              </label>
            )}
            <label>
              아이디
              <input
                name="username"
                autoComplete="username"
                pattern="[a-zA-Z0-9_]{3,30}"
                title="영문, 숫자, 밑줄 3~30자"
                placeholder="아이디를 입력하세요"
                required
                minLength={3}
                maxLength={30}
              />
            </label>
            <label>
              비밀번호
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                placeholder="8자 이상 입력하세요"
                required
                minLength={8}
                maxLength={128}
              />
            </label>
            {register && (
              <label>
                스터디 초대 코드
                <input
                  name="invite"
                  placeholder="관리자에게 받은 코드"
                  required
                />
              </label>
            )}
            {error && (
              <div role="alert" className="login-error">
                {error}
              </div>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "연결 중…" : register ? "가입하고 시작하기" : "로그인"}
              <ArrowUpRight size={17} />
            </button>
          </form>
          <div className="login-switch">
            {register ? "이미 계정이 있나요?" : "처음 방문하셨나요?"}
            <button
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "로그인" : "초대 코드로 가입"}
            </button>
          </div>
          <div className="login-info">
            <ShieldCheck size={18} />
            <span>
              모든 투자금과 주문은 가상으로 처리됩니다.
              {provider === "demo" && (
                <small>현재 샘플 시세 모드로 운영 중입니다.</small>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
