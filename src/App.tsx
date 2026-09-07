import { tickSize } from "./tradingRules";
import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  Clock3,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Search,
  ShieldCheck,
  Star,
  Trophy,
  Wallet,
  X,
  Plus,
  RefreshCw,
} from "lucide-react";
import Chart from "./Chart";
import AdvancedChart from "./AdvancedChart";
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
} from "./types";
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pct = (n: number) => (n > 0 ? "+" : "") + n.toFixed(2) + "%";
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
type Detail = { quote: Quote; candles: Candle[]; book: Book };
type Ranking = {
  id: number;
  name: string;
  deposits: number;
  assets: number | null;
  rate: number | null;
};
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [provider, setProvider] = useState("demo");
  const [feedStatus, setFeedStatus] = useState("연결 중");
  const [chartExpanded, setChartExpanded] = useState(false);
  const [page, setPage] = useState("trade"),
    [stocks, setStocks] = useState<Stock[]>([]),
    [quotes, setQuotes] = useState<Quote[]>([]),
    [account, setAccount] = useState<Account | null>(null),
    [symbol, setSymbol] = useState("005930"),
    [period, setPeriod] = useState("D"),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailError, setDetailError] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [search, setSearch] = useState(""),
    [onlyStars, setOnlyStars] = useState(false),
    [stars, setStars] = useState<string[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [grants, setGrants] = useState<Grant[]>([]),
    [ranking, setRanking] = useState<Ranking[]>([]);
  const [side, setSide] = useState<"buy" | "sell">("buy"),
    [orderType, setOrderType] = useState<"market" | "limit">("market"),
    [quantity, setQuantity] = useState("1"),
    [limit, setLimit] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("holdings"),
    [grantUser, setGrantUser] = useState(""),
    [grantAmount, setGrantAmount] = useState("10000000"),
    [grantNote, setGrantNote] = useState("스터디 시작 투자금");
  const [marketFilter, setMarketFilter] = useState("ALL"),
    [stockPage, setStockPage] = useState(0),
    [catalogDate, setCatalogDate] = useState<string | null>(null);
  const filteredStocks = useMemo(
    () =>
      stocks.filter(
        (s) =>
          (marketFilter === "ALL" || s.market === marketFilter) &&
          (!onlyStars || stars.includes(s.symbol)) &&
          (s.name.toLowerCase().includes(search.trim().toLowerCase()) ||
            s.symbol.toLowerCase().includes(search.trim().toLowerCase())),
      ),
    [stocks, marketFilter, onlyStars, stars, search],
  );
  const pageCount = Math.max(1, Math.ceil(filteredStocks.length / 10));
  const currentStockPage = Math.min(stockPage, pageCount - 1);
  const visibleStocks = filteredStocks.slice(
    currentStockPage * 10,
    currentStockPage * 10 + 10,
  );
  const quoteSymbols = visibleStocks.map((s) => s.symbol).join(",");
  useEffect(() => setStockPage(0), [marketFilter, onlyStars, search]);
  const orderRequest = useRef<string | null>(null),
    grantRequest = useRef<string | null>(null);
  useEffect(() => {
    Promise.all([
      api<{ provider: string }>("/meta").then((m) => setProvider(m.provider)),
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
    const d = await api<{ members: Member[]; grants: Grant[] }>(
      "/admin/members",
    );
    setMembers(d.members);
    setGrants(d.grants);
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
        const d = await api<Detail>("/stock/" + symbol + "?period=" + period);
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
    if (page === "admin" && user?.role === "admin")
      refreshAdmin().catch((e) => setError(e.message));
    if (page === "ranking")
      api<{ members: Ranking[] }>("/ranking")
        .then((d) => setRanking(d.members))
        .catch((e) => setError(e.message));
  }, [page, user, refreshAdmin]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    orderRequest.current = null;
  }, [symbol, side, orderType, quantity, limit, note]);
  useEffect(() => {
    grantRequest.current = null;
  }, [grantUser, grantAmount, grantNote]);
  function star(s: string) {
    const next = stars.includes(s)
      ? stars.filter((x) => x !== s)
      : [...stars, s];
    setStars(next);
    localStorage.setItem("study-stars-" + user!.id, JSON.stringify(next));
  }
  async function order(e: FormEvent) {
    e.preventDefault();
    if (busy || !detail) return;
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
  const stock = stocks.find((s) => s.symbol === symbol),
    q = detail?.quote;
  const current = q?.price || 0;
  const held = account?.holdings.find((h) => h.symbol === symbol);
  const totalAssets =
    account && account.holdings.every((h) => h.price !== null)
      ? account.cash +
        account.holdings.reduce((s, h) => s + h.quantity * h.price!, 0)
      : null;
  const profit =
    totalAssets !== null ? totalAssets - (account?.deposits || 0) : null;
  const rate =
    profit !== null && account?.deposits
      ? (profit / account.deposits) * 100
      : 0;
  const opposing =
    (side === "buy" ? detail?.book.asks : detail?.book.bids)
      ?.filter((l) => l.price > 0 && l.quantity > 0)
      .sort((a, b) =>
        side === "buy" ? a.price - b.price : b.price - a.price,
      ) ?? [];
  const orderPrice =
    orderType === "market" ? (opposing[0]?.price ?? 0) : Number(limit);
  let expectedAmount = 0,
    expectedFilled = 0,
    affordable = 0,
    budget = account?.available ?? 0;
  for (const level of opposing) {
    const take = Math.min(
      Math.max(0, Number(quantity) - expectedFilled),
      level.quantity,
    );
    expectedAmount += take * level.price;
    expectedFilled += take;
    const canBuy = Math.min(level.quantity, Math.floor(budget / level.price));
    affordable += canBuy;
    budget -= canBuy * level.price;
  }
  const maxQty =
    side === "buy"
      ? orderType === "market"
        ? affordable
        : Math.floor((account?.available || 0) / (orderPrice || Infinity))
      : (held?.quantity || 0) - (held?.reserved || 0);
  const pending = account?.orders.filter((o) => o.status === "pending") || [];
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
        <nav>
          {[
            ["trade", "트레이딩", BarChart3],
            ["account", "내 투자 계좌", Wallet],
            ["ranking", "스터디 랭킹", Trophy],
            ...(user.role === "admin"
              ? [["admin", "관리자", ShieldCheck]]
              : []),
          ].map(([key, label, Icon]) => {
            const I = Icon as typeof BarChart3;
            return (
              <button
                key={String(key)}
                className={page === key ? "nav-item active" : "nav-item"}
                onClick={() => setPage(String(key))}
              >
                <I size={19} />
                {String(label)}
                {page === key && <span className="nav-dot" />}
              </button>
            );
          })}
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
            onClick={async () => {
              try {
                await api("/logout", {});
                setUser(null);
                setAccount(null);
                setPage("trade");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
            title="로그아웃"
          >
            <span className="avatar">{user.name[0]}</span>
            <span>
              {user.name}
              <small>
                {user.role === "admin" ? "스터디 관리자" : "스터디 멤버"}
              </small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            워크스페이스 <ChevronRight size={14} />
            <b>
              {
                {
                  trade: "트레이딩",
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
        <div className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR NEXT INVESTMENT, TOGETHER</div>
              <h1>
                {
                  {
                    trade: "시장을 읽고, 투자를 연습해요.",
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
          <div className={"mode-banner " + (provider === "kis" ? "live" : "")}>
            <span className="banner-dot" />
            <strong>
              {provider === "demo"
                ? "샘플 데이터로 체험 중이에요"
                : "한국투자증권 시세를 사용하고 있어요"}
            </strong>
            <span>
              {provider === "demo"
                ? "표시된 가격·차트·호가는 실제 시장 데이터가 아닙니다."
                : "수신한 호가와 모의 잔량으로 체결합니다. 실제 주문은 전송되지 않습니다."}
            </span>
          </div>
          {error && (
            <div role="alert" className="error-banner">
              {error}
              <button onClick={() => setError("")} aria-label="오류 닫기">
                <X size={16} />
              </button>
            </div>
          )}
          <section className="summary-grid">
            <Summary
              title="총 평가자산"
              value={totalAssets === null ? "—" : won(totalAssets)}
              unit="원"
              icon={<Wallet size={18} />}
              sub="현금 + 보유 주식 평가금액"
            />
            <Summary
              title="총 투자손익"
              value={
                profit === null ? "—" : (profit > 0 ? "+" : "") + won(profit)
              }
              unit="원"
              color={profit !== null && profit < 0 ? "down" : "up"}
              sub={
                account?.deposits
                  ? "누적 수익률 " + pct(rate)
                  : "투자금 지급 후 수익률이 표시됩니다."
              }
              icon={<Activity size={18} />}
            />
            <Summary
              title="주문 가능 금액"
              value={won(account?.available || 0)}
              unit="원"
              sub={
                "주문 예약금 " +
                won((account?.cash || 0) - (account?.available || 0)) +
                "원"
              }
              icon={<ArrowDownLeft size={18} />}
            />
            <Summary
              title="누적 지급 투자금"
              value={won(account?.deposits || 0)}
              unit="원"
              sub="관리자가 지급한 가상 투자금"
              icon={<GraduationCap size={18} />}
            />
          </section>
          {page === "trade" && (
            <>
              <div className="trade-grid">
                <section className="panel stock-panel">
                  <div className="panel-heading">
                    <h2>종목 탐색</h2>
                    <span className="muted">{stocks.length}종목</span>
                  </div>
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label="종목 검색"
                      placeholder="종목명, 종목코드 검색"
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
                  <div
                    className="market-filter"
                    role="group"
                    aria-label="주식 시장 선택"
                  >
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
                  <div className="stock-result-count">
                    {filteredStocks.length.toLocaleString()}종목 · 주요 종목
                    우선 / 이름순
                  </div>
                  <div className="stock-list">
                    {visibleStocks.map((s) => {
                      const sq = quotes.find((q) => q.symbol === s.symbol);
                      return (
                        <div
                          key={s.symbol}
                          className={
                            "stock-row " +
                            (symbol === s.symbol ? "selected" : "")
                          }
                        >
                          <button
                            aria-label={s.name + " 관심 종목"}
                            className={
                              "star " + (stars.includes(s.symbol) ? "on" : "")
                            }
                            onClick={() => star(s.symbol)}
                          >
                            <Star
                              size={15}
                              fill={
                                stars.includes(s.symbol)
                                  ? "currentColor"
                                  : "none"
                              }
                            />
                          </button>
                          <button
                            className="stock-select"
                            onClick={() => {
                              setSymbol(s.symbol);
                              setLimit("");
                            }}
                          >
                            <span>
                              <b>{s.name}</b>
                              <small>
                                {s.symbol} · {s.market}
                              </small>
                            </span>
                            <span className="stock-price">
                              <b>{sq ? won(sq.price) : "—"}</b>
                              <small
                                className={sq && sq.change >= 0 ? "up" : "down"}
                              >
                                {sq ? pct(sq.changeRate) : "조회 중"}
                              </small>
                            </span>
                          </button>
                        </div>
                      );
                    })}
                    {filteredStocks.length === 0 && (
                      <div className="empty small">검색 결과가 없습니다.</div>
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
                      catalogDate
                        ? "종목 목록 갱신: " + date(catalogDate)
                        : "기본 목록"
                    }
                  >
                    <span className="status-dot" />
                    {provider === "demo"
                      ? "샘플 시세 · 실제 가격 아님"
                      : "전체 주식 · ETF·ETN 제외"}
                  </div>
                </section>
                <section className="panel chart-panel">
                  <div className="instrument">
                    <div className="stock-avatar">
                      {stock?.name.slice(0, 1) || "S"}
                    </div>
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
                        fill={stars.includes(symbol) ? "currentColor" : "none"}
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
                      onClick={() => setChartExpanded(true)}
                    >
                      <BarChart3 size={14} /> 자세히 보기 · 그리기
                    </button>
                  </div>
                  {detail ? (
                    <Chart bars={detail.candles.slice(-100)} />
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
                <section className="panel order-panel">
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
                          min="1"
                          max="100000000"
                          step="1"
                          required={orderType === "limit"}
                          disabled={orderType === "market"}
                          placeholder="가격 입력"
                          value={
                            orderType === "market" ? orderPrice || "" : limit
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
                          min="1"
                          max="1000000"
                          step="1"
                          required
                          value={quantity}
                          onChange={(e) => setQuantity(e.target.value)}
                        />
                        <span>주</span>
                      </div>
                    </label>
                    <div className="quantity-shortcuts">
                      {[25, 50, 100].map((n) => (
                        <button
                          type="button"
                          key={n}
                          onClick={() =>
                            setQuantity(String(Math.floor((maxQty * n) / 100)))
                          }
                        >
                          {n === 100 ? "최대" : n + "%"}
                        </button>
                      ))}
                    </div>
                    <div className="order-available">
                      <span>{side === "buy" ? "매수" : "매도"} 가능</span>
                      <b>{won(maxQty)}주</b>
                    </div>
                    <label>
                      매매 이유 <span className="optional">선택</span>
                      <input
                        aria-label="매매 이유"
                        maxLength={300}
                        placeholder="이번 투자의 생각을 남겨보세요"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </label>
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
                    </div>
                    <button
                      className={"submit-order " + side}
                      disabled={
                        busy || !detail || Number(quantity) < 1 || !orderPrice
                      }
                      type="submit"
                    >
                      {busy
                        ? "처리 중…"
                        : (stock?.name || "") +
                          " " +
                          (side === "buy" ? "매수" : "매도")}
                    </button>
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
                    <Holdings account={account} onSelect={setSymbol} />
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
                <section className="panel book-panel">
                  <div className="panel-heading">
                    <h2>호가</h2>
                    <small className="muted">
                      {provider === "demo" ? "샘플 호가" : "조회 호가"}
                    </small>
                  </div>
                  <div className="book-label">
                    <span>가격 (원)</span>
                    <span>잔량 (주)</span>
                  </div>
                  {detail ? (
                    [
                      ...[...detail.book.asks]
                        .reverse()
                        .map((b) => ({ ...b, side: "ask" })),
                      ...detail.book.bids.map((b) => ({ ...b, side: "bid" })),
                    ].map((b, i) => (
                      <button
                        className={"book-row " + b.side}
                        key={i}
                        onClick={() => {
                          setOrderType("limit");
                          setLimit(String(b.price));
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
                    <div className="empty small">호가를 불러오는 중입니다.</div>
                  )}
                </section>
              </div>
            </>
          )}
          {page === "account" && (
            <>
              <section className="panel spaced">
                <div className="panel-heading">
                  <h2>보유 종목</h2>
                  <span className="muted">
                    실현손익 {won(account?.realized || 0)}원
                  </span>
                </div>
                <Holdings
                  account={account}
                  onSelect={(s) => {
                    setSymbol(s);
                    setPage("trade");
                  }}
                />
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>주문 · 체결 내역</h2>
                  <span className="muted">최근 200건</span>
                </div>
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
              </section>
            </>
          )}
          {page === "admin" && (
            <div className="admin-grid">
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
                  <table>
                    <thead>
                      <tr>
                        <th>멤버</th>
                        <th>역할</th>
                        <th>보유 현금</th>
                        <th>누적 지급액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <b>{m.name}</b>
                            <small>@{m.username}</small>
                          </td>
                          <td>{m.role === "admin" ? "관리자" : "멤버"}</td>
                          <td>{won(m.cash)}원</td>
                          <td>{won(m.deposits)}원</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="panel grant-history">
                <div className="panel-heading">
                  <h2>투자금 지급 기록</h2>
                </div>
                {grants.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>지급일시</th>
                          <th>받은 멤버</th>
                          <th>금액</th>
                          <th>사유</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grants.map((g) => (
                          <tr key={g.id}>
                            <td>{date(g.created_at)}</td>
                            <td>{g.name}</td>
                            <td className="mint">+{won(g.amount)}원</td>
                            <td>{g.note}</td>
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
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  <Trophy size={18} /> 스터디 수익률 랭킹
                </h2>
                <button
                  className="text-button"
                  onClick={() =>
                    api<{ members: Ranking[] }>("/ranking")
                      .then((d) => setRanking(d.members))
                      .catch((e) => setError(e.message))
                  }
                >
                  <RefreshCw size={14} /> 새로고침
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>순위</th>
                      <th>멤버</th>
                      <th>누적 지급액</th>
                      <th>평가자산</th>
                      <th>수익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((r, i) => (
                      <tr key={r.id}>
                        <td>
                          <span
                            className={
                              "rank " +
                              (i === 0 && r.rate !== null ? "first" : "")
                            }
                          >
                            {r.rate === null ? "—" : i + 1}
                          </span>
                        </td>
                        <td>
                          <b>{r.name}</b>
                          {r.id === user.id && (
                            <span className="me-tag">나</span>
                          )}
                        </td>
                        <td>{won(r.deposits)}원</td>
                        <td>
                          {r.assets === null
                            ? "시세 확인 필요"
                            : won(r.assets) + "원"}
                        </td>
                        <td
                          className={
                            r.rate !== null && r.rate < 0 ? "down" : "up"
                          }
                        >
                          {r.rate === null ? "집계 전" : pct(r.rate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ranking-note">
                수익률 = (평가자산 − 누적 지급액) ÷ 누적 지급액. 추가 지급 시
                분모가 바뀌므로 공정한 비교를 위해 같은 금액과 지급 시점을
                권장합니다.
              </p>
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
          key={user.id + ":" + symbol + ":" + period}
          bars={detail?.candles ?? []}
          symbol={symbol}
          name={stock?.name ?? symbol}
          userId={user.id}
          period={period}
          onPeriod={setPeriod}
          onClose={() => setChartExpanded(false)}
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
      <table>
        <thead>
          <tr>
            <th>종목</th>
            <th>보유 수량</th>
            <th>평균 매수가</th>
            <th>현재가</th>
            <th>평가손익</th>
          </tr>
        </thead>
        <tbody>
          {account.holdings.map((h) => {
            const pl = h.price === null ? null : h.quantity * h.price - h.cost;
            return (
              <tr key={h.symbol}>
                <td>
                  <button
                    className="table-link"
                    onClick={() => onSelect(h.symbol)}
                  >
                    {h.name}
                  </button>
                  <small>{h.symbol}</small>
                </td>
                <td>
                  {won(h.quantity)}주
                  {h.reserved > 0 && <small>예약 {h.reserved}주</small>}
                </td>
                <td>{won(h.cost / h.quantity)}원</td>
                <td>{h.price === null ? "—" : won(h.price) + "원"}</td>
                <td className={pl !== null && pl < 0 ? "down" : "up"}>
                  {pl === null
                    ? "시세 확인 필요"
                    : (pl > 0 ? "+" : "") + won(pl) + "원"}
                  {pl !== null && <small>{pct((pl / h.cost) * 100)}</small>}
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
}: {
  account: Account | null;
  stocks: Stock[];
  onCancel: (id: number) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Account["orders"][number] | null>(
    null,
  );
  const [editPrice, setEditPrice] = useState(""),
    [editQty, setEditQty] = useState(""),
    [editError, setEditError] = useState(""),
    [saving, setSaving] = useState(false);
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
        <strong>아직 주문 내역이 없어요</strong>
        <span>매수·매도 주문과 체결 기록을 확인할 수 있습니다.</span>
      </div>
    );
  return (
    <div className="table-wrap">
      {editing && (
        <form className="amend-form" onSubmit={amend}>
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
              min="1"
              step={tickSize(Number(editPrice))}
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
      <table>
        <thead>
          <tr>
            <th>주문일시 / 종목</th>
            <th>구분</th>
            <th>수량 / 가격</th>
            <th>상태</th>
            <th>매매 이유</th>
          </tr>
        </thead>
        <tbody>
          {account.orders.map((o) => (
            <tr key={o.id}>
              <td>
                <b>
                  {stocks.find((s) => s.symbol === o.symbol)?.name || o.symbol}
                </b>
                <small>{date(o.created_at)}</small>
              </td>
              <td className={o.side === "buy" ? "up" : "down"}>
                {o.side === "buy" ? "매수" : "매도"}
                <small>{o.type === "market" ? "시장가" : "지정가"}</small>
              </td>
              <td>
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
              </td>
              <td>
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
                {o.cancel_reason && <small>{o.cancel_reason}</small>}
                {o.replaces_id && <small>주문 #{o.replaces_id} 정정</small>}
                {o.expires_at && o.status === "pending" && (
                  <small>
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
              <td className="note-cell">
                {o.note || "—"}
                {!!o.fills?.length && (
                  <details className="fill-details">
                    <summary>체결 상세 ({o.fills.length})</summary>
                    {o.fills.map((f) => (
                      <small key={f.id}>
                        {date(f.created_at)} · {won(f.price)}원 ×{" "}
                        {won(f.quantity)}주
                      </small>
                    ))}
                  </details>
                )}
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
