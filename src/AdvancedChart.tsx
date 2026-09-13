import { useDrawingSync } from "./useDrawingSync";
import { useChartZoomGestures } from "./useChartZoomGestures";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  MousePointer2,
  Move,
  Minus,
  TrendingUp,
  Square,
  PenLine,
  Undo2,
  Redo2,
  Trash2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  SlidersHorizontal,
  Settings2,
  X,
} from "lucide-react";
import type { Candle } from "./types";
import {
  zoomPeriod,
  zoomDateWindow,
  windowIndices,
  shiftChartDate,
  periodName,
  type ChartWindow,
} from "./chartViewport";
import {
  calculateBollinger,
  calculateRsi,
  calculateMacd,
  calculateStochastic,
  calculateAtr,
  calculateObv,
  calculateCci,
  calculateMfi,
  ema,
  indicatorDefinitions,
  bollingerPosition,
  type Indicator,
  type NullableSeries,
} from "./chartIndicators";
type Tool = "select" | "pan" | "trend" | "horizontal" | "rectangle" | "pen";
type Anchor = { date: string; offset: number; price: number };
type Drawing = {
  id: string;
  tool: Exclude<Tool, "select" | "pan">;
  points: Anchor[];
  color: string;
  width: number;
};
type Props = {
  bars: Candle[];
  symbol: string;
  name: string;
  userId: number;
  period: string;
  onPeriod: (p: string, window?: ChartWindow) => void;
  initialWindow?: ChartWindow;
  onClose: () => void;
  error: string;
  source: string;
};
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
const periods = [5, 20, 60] as const;
type IndicatorPanel = {
  key: Indicator;
  label: string;
  lines: {
    label: string;
    values: NullableSeries;
    color: string;
    dashed?: boolean;
  }[];
  levels: number[];
  bounds?: [number, number];
  histogram?: NullableSeries;
};
const indicatorNumber = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? "계산 대기"
    : value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const maColors = ["#42aa70", "#ed8050", "#a778e7"];
export default function AdvancedChart({
  bars: incomingBars,
  symbol,
  name,
  userId,
  period,
  onPeriod,
  initialWindow,
  onClose,
  error,
  source,
}: Props) {
  const initialCount = useRef(
    window.matchMedia("(max-width: 600px)").matches ? 50 : 100,
  ).current;
  const [simple, setSimple] = useState(() => {
    try {
      return (
        localStorage.getItem("amicom-chart-view-v1:" + userId) !== "analysis"
      );
    } catch {
      return true;
    }
  });
  const [controlPanel, setControlPanel] = useState<
    "indicators" | "drawing" | "display" | null
  >(null);
  const controlTitle = useRef<HTMLHeadingElement>(null);
  const controlOpener = useRef<HTMLElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  useEffect(() => {
    const resize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        "amicom-chart-view-v1:" + userId,
        simple ? "simple" : "analysis",
      );
    } catch {
      /* optional preference */
    }
  }, [simple, userId]);
  useEffect(() => {
    if (controlPanel) controlTitle.current?.focus();
  }, [controlPanel]);
  const [bars, setBars] = useState(initialWindow ? [] : incomingBars);
  const [windowLoading, setWindowLoading] = useState(!!initialWindow);
  const [windowError, setWindowError] = useState("");
  const [windowRetry, setWindowRetry] = useState(0);
  const [automaticPeriod, setAutomaticPeriod] = useState(() => {
    try {
      return localStorage.getItem("amicom-auto-period:" + userId) !== "false";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "amicom-auto-period:" + userId,
        String(automaticPeriod),
      );
    } catch {
      /* Optional browser preference. */
    }
  }, [automaticPeriod, userId]);
  const [loadingPast, setLoadingPast] = useState(false),
    [hasPast, setHasPast] = useState(true),
    [pastError, setPastError] = useState("");
  const initialized = useRef(!initialWindow && incomingBars.length > 0);
  useEffect(() => {
    if (!incomingBars.length) return;
    if (initialWindow) {
      // Update overlapping candles only; do not join an old window to unrelated recent data.
      if (initialized.current) {
        const fresh = new Map(incomingBars.map((b) => [b.date, b]));
        setBars((old) => old.map((b) => fresh.get(b.date) ?? b));
      }
      return;
    }
    setBars((old) =>
      [
        ...new Map([...old, ...incomingBars].map((b) => [b.date, b])).values(),
      ].sort((a, b) => a.date.localeCompare(b.date)),
    );
    if (!initialized.current) {
      setStart(Math.max(0, incomingBars.length - initialCount));
      initialized.current = true;
    }
  }, [incomingBars, initialWindow, initialCount]);
  useEffect(() => {
    if (!initialWindow) return;
    const controller = new AbortController();
    setWindowLoading(true);
    setWindowError("");
    async function loadWindow() {
      try {
        let collected: Candle[] = [],
          before = shiftChartDate(initialWindow!.to, 1),
          more = true;
        // Fetch the requested historical date directly, then enough earlier candles for indicators.
        for (let page = 0; page < 4; page++) {
          const response = await fetch(
            `/api/history/${symbol}?period=${period}&before=${before}`,
            { signal: controller.signal },
          );
          const data = await response.json();
          if (!response.ok)
            throw Error(
              data.error || "해당 구간의 시세를 불러오지 못했습니다.",
            );
          const older = (data.candles as Candle[]).filter(
            (b) => b.date < before,
          );
          if (!older.length) {
            more = false;
            break;
          }
          collected = [
            ...new Map(
              [...older, ...collected].map((b) => [b.date, b]),
            ).values(),
          ].sort((a, b) => a.date.localeCompare(b.date));
          before = collected[0].date;
          if (
            collected.filter((b) => b.date < initialWindow!.from).length >= 60
          )
            break;
        }
        if (controller.signal.aborted) return;
        const viewport = windowIndices(collected, initialWindow!);
        if (!viewport)
          throw Error(
            "보고 있던 날짜에 표시할 시세가 없습니다. 다른 구간을 선택해주세요.",
          );
        setBars(collected);
        setStart(viewport.start);
        setCount(viewport.count);
        setHasPast(more);
        initialized.current = true;
      } catch (e) {
        if (!controller.signal.aborted) setWindowError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setWindowLoading(false);
      }
    }
    void loadWindow();
    return () => controller.abort();
  }, [initialWindow, period, symbol, windowRetry]);
  async function loadPast() {
    if (loadingPast || !bars.length) return;
    setLoadingPast(true);
    setPastError("");
    try {
      const res = await fetch(
        "/api/history/" +
          symbol +
          "?period=" +
          period +
          "&before=" +
          bars[0].date,
      );
      const data = await res.json();
      if (!res.ok) throw Error(data.error);
      const older = (data.candles as Candle[]).filter(
        (b) => b.date < bars[0].date,
      );
      setBars((old) => [...older, ...old]);
      setStart((v) => v + older.length);
      setHasPast(older.length > 0);
    } catch (e) {
      setPastError((e as Error).message);
    } finally {
      setLoadingPast(false);
    }
  }
  const dialog = useRef<HTMLDialogElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const clipId = useId().replaceAll(":", "");
  const storageKey = "amicom-chart-v1:" + userId + ":" + symbol + ":" + period;
  const [notice, setNotice] = useState("");
  const [drawings, setDrawings] = useState<Drawing[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw
        .filter(
          (d: Drawing) =>
            d &&
            typeof d.id === "string" &&
            ["trend", "horizontal", "rectangle", "pen"].includes(d.tool) &&
            /^#[0-9a-f]{6}$/i.test(d.color) &&
            [1, 2, 3, 4].includes(d.width) &&
            Array.isArray(d.points) &&
            d.points.length > 0 &&
            d.points.length <= 600 &&
            d.points.every(
              (p) =>
                /^\d{4}-\d{2}-\d{2}$/.test(p.date) &&
                Number.isFinite(p.price) &&
                Number.isFinite(p.offset),
            ),
        )
        .slice(0, 200);
    } catch {
      return [];
    }
  });
  const sync = useDrawingSync(symbol, period, drawings, setDrawings);
  const leave = () => {
    if (sync.saving || sync.dirty) {
      setNotice(
        "그림 저장이 완료된 후 닫을 수 있습니다. 저장 실패 시 다시 시도해주세요.",
      );
      return;
    }
    onClose();
  };
  const [history, setHistory] = useState<Drawing[][]>([]),
    [future, setFuture] = useState<Drawing[][]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [draft, setDraft] = useState<Drawing | null>(null),
    [tool, setTool] = useState<Tool>("select"),
    [color, setColor] = useState("#e7a33f"),
    [width, setWidth] = useState(2),
    [hover, setHover] = useState<{ x: number; y: number } | null>(null),
    [count, setCount] = useState(initialCount),
    [start, setStart] = useState(
      Math.max(0, incomingBars.length - initialCount),
    ),
    [averages, setAverages] = useState<number[]>([5, 20, 60]),
    [indicators, setIndicators] = useState<Indicator[]>(() => {
      try {
        const saved = JSON.parse(
          localStorage.getItem("amicom-indicators-v1:" + userId) || "null",
        );
        if (Array.isArray(saved))
          return indicatorDefinitions
            .filter((d) => saved.includes(d.key))
            .map((d) => d.key);
      } catch {
        /* Use defaults if browser storage is unavailable. */
      }
      return ["bollinger", "rsi"];
    });
  useEffect(() => {
    try {
      localStorage.setItem(
        "amicom-indicators-v1:" + userId,
        JSON.stringify(indicators),
      );
    } catch {
      /* Charts remain usable without storage. */
    }
  }, [indicators, userId]);
  const gesture = useRef<
    | { kind: "draw"; drawing: Drawing }
    | { kind: "pan"; x: number; start: number }
    | null
  >(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 620 });
  useEffect(() => {
    const el = canvas.current!;
    const observer = new ResizeObserver(() =>
      setSize({
        width: Math.max(320, el.clientWidth),
        height: Math.max(230, el.clientHeight),
      }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const activeIndicators = simple ? [] : indicators;
  const displayedAverages = simple ? [20] : averages;
  const panelCount = activeIndicators.filter(
    (key) => key !== "bollinger" && key !== "ema",
  ).length;
  const chartMinHeight =
    (simple
      ? Math.max(
          320,
          Math.min(700, viewportHeight - (size.width < 750 ? 310 : 350)),
        )
      : 420) +
    panelCount * 144;
  const W = size.width,
    H = Math.max(size.height, chartMinHeight),
    L = 20,
    R = size.width < 600 ? 65 : 90,
    T = 30,
    volumeBottom = H - 30 - panelCount * 144,
    volumeTop = volumeBottom - 62,
    B = volumeTop - 28;
  const shown = Math.min(bars.length, Math.max(10, count)),
    first = clamp(start, 0, Math.max(0, bars.length - shown)),
    visible = bars.slice(first, first + shown),
    step = (W - L - R) / Math.max(1, shown);
  const movingAverages = useMemo(
    () =>
      periods.map((n) =>
        bars.map((_, i) =>
          i + 1 < n
            ? null
            : bars
                .slice(i + 1 - n, i + 1)
                .reduce((sum, b) => sum + b.close, 0) / n,
        ),
      ),
    [bars],
  );
  const bollinger = useMemo(() => calculateBollinger(bars), [bars]);
  const rsi = useMemo(() => calculateRsi(bars), [bars]);
  const macd = useMemo(() => calculateMacd(bars), [bars]);
  const ema20 = useMemo(
    () =>
      ema(
        bars.map((b) => b.close),
        20,
      ),
    [bars],
  );
  const stochastic = useMemo(() => calculateStochastic(bars), [bars]);
  const cci = useMemo(() => calculateCci(bars), [bars]);
  const mfi = useMemo(() => calculateMfi(bars), [bars]);
  const atr = useMemo(() => calculateAtr(bars), [bars]);
  const obv = useMemo(() => calculateObv(bars), [bars]);
  const allPanels: IndicatorPanel[] = [
    {
      key: "rsi",
      label: "RSI(14)",
      lines: [{ label: "RSI", values: rsi, color: "var(--indicator-gold)" }],
      levels: [30, 50, 70],
      bounds: [0, 100],
    },
    {
      key: "macd",
      label: "MACD(12,26,9)",
      lines: [
        { label: "MACD", values: macd.line, color: "var(--indicator-teal)" },
        {
          label: "Signal",
          values: macd.signal,
          color: "var(--indicator-gold)",
          dashed: true,
        },
      ],
      histogram: macd.histogram,
      levels: [0],
    },
    {
      key: "stochastic",
      label: "스토캐스틱(14,3,3)",
      lines: [
        { label: "%K", values: stochastic.k, color: "var(--indicator-teal)" },
        {
          label: "%D",
          values: stochastic.d,
          color: "var(--indicator-gold)",
          dashed: true,
        },
      ],
      levels: [20, 50, 80],
      bounds: [0, 100],
    },
    {
      key: "cci",
      label: "CCI(20)",
      lines: [{ label: "CCI", values: cci, color: "var(--indicator-purple)" }],
      levels: [-100, 0, 100],
    },
    {
      key: "mfi",
      label: "MFI(14)",
      lines: [{ label: "MFI", values: mfi, color: "var(--indicator-teal)" }],
      levels: [20, 50, 80],
      bounds: [0, 100],
    },
    {
      key: "obv",
      label: "OBV · 누적 거래량(주)",
      lines: [{ label: "OBV", values: obv, color: "var(--indicator-purple)" }],
      levels: [],
    },
    {
      key: "atr",
      label: "ATR(14) · 변동폭(원)",
      lines: [{ label: "ATR", values: atr, color: "var(--indicator-gold)" }],
      levels: [0],
    },
  ];
  const panels = allPanels.filter((panel) =>
    activeIndicators.includes(panel.key),
  );
  const maValues = movingAverages.flatMap((v, i) =>
    displayedAverages.includes(periods[i])
      ? v.slice(first, first + shown).filter((n): n is number => n !== null)
      : [],
  );
  const bollingerValues = activeIndicators.includes("bollinger")
    ? [bollinger.upper, bollinger.lower].flatMap((series) =>
        series
          .slice(first, first + shown)
          .filter((n): n is number => n !== null),
      )
    : [];
  if (activeIndicators.includes("ema"))
    maValues.push(
      ...ema20
        .slice(first, first + shown)
        .filter((v): v is number => v !== null),
    );
  const high =
      Math.max(
        1,
        ...visible.map((b) => b.high),
        ...maValues,
        ...bollingerValues,
      ) * 1.025,
    low =
      Math.min(
        ...visible.map((b) => b.low),
        ...maValues,
        ...bollingerValues,
        high * 0.98,
      ) * 0.975;
  const scaleY = (p: number) => T + ((high - p) / (high - low)) * (B - T);
  const priceAt = (y: number) => high - ((y - T) / (B - T)) * (high - low);
  const linePoints = (series: NullableSeries, scale = scaleY) =>
    series
      .slice(first, first + shown)
      .flatMap((value, i) =>
        value === null ? [] : [L + (i + 0.5) * step + "," + scale(value)],
      )
      .join(" ");
  const bandPoints =
    linePoints(bollinger.upper) +
    " " +
    linePoints(bollinger.lower).split(" ").reverse().join(" ");
  const indexAt = (x: number) => first + (x - L) / step - 0.5;
  function anchorAt(x: number, y: number): Anchor {
    const index = clamp(indexAt(x), 0, Math.max(0, bars.length - 1));
    const i = Math.floor(index);
    return {
      date: bars[i].date,
      offset: index - i,
      price: priceAt(clamp(y, T, B)),
    };
  }
  function anchorX(p: Anchor) {
    let i = bars.findIndex((b) => b.date === p.date);
    if (i < 0) {
      i = bars.findIndex((b) => b.date > p.date);
      if (i < 0) i = bars.length;
      else if (i === 0) i = -1;
    }
    return L + (i + p.offset - first + 0.5) * step;
  }
  function coords(e: ReactPointerEvent<SVGSVGElement>) {
    const matrix = e.currentTarget.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      matrix.inverse(),
    );
    return { x: p.x, y: p.y };
  }
  function commit(next: Drawing[]) {
    if (!sync.ready) return;
    setHistory((h) => [...h.slice(-39), drawings]);
    setFuture([]);
    setDrawings(next);
    setSelected(null);
  }
  function undo() {
    if (!sync.ready || !history.length) return;
    setFuture((f) => [drawings, ...f].slice(0, 40));
    setDrawings(history.at(-1)!);
    setHistory((h) => h.slice(0, -1));
    setSelected(null);
  }
  function redo() {
    if (!sync.ready || !future.length) return;
    setHistory((h) => [...h, drawings].slice(-40));
    setDrawings(future[0]);
    setFuture((f) => f.slice(1));
    setSelected(null);
  }
  function remove() {
    if (selected) commit(drawings.filter((d) => d.id !== selected));
  }
  const zoomInPeriod = zoomPeriod(
    period,
    shown,
    bars.length,
    0.7,
    automaticPeriod,
  );
  const zoomOutPeriod = zoomPeriod(
    period,
    shown,
    bars.length,
    1.4,
    automaticPeriod,
  );
  const zoomBusy =
    windowLoading || !bars.length || sync.saving || sync.dirty || !!draft;
  const transitionRequested = useRef(false);
  function zoom(factor: number, anchorRatio = 0.5) {
    if (zoomBusy || transitionRequested.current || gesture.current) return;
    const nextPeriod = zoomPeriod(
      period,
      shown,
      bars.length,
      factor,
      automaticPeriod,
    );
    if (nextPeriod !== period) {
      transitionRequested.current = true;
      onPeriod(
        nextPeriod,
        zoomDateWindow(visible, period, factor, anchorRatio),
      );
      return;
    }
    const next = clamp(
      Math.round(shown * factor),
      Math.min(10, bars.length),
      bars.length,
    );
    setCount(next);
    setStart(
      clamp(
        Math.round(first + (shown - next) * anchorRatio),
        0,
        bars.length - next,
      ),
    );
  }
  const pinching = useChartZoomGestures(canvas, {
    zoom,
    anchorRatio: (clientX) => {
      const rect = svg.current?.getBoundingClientRect();
      if (!rect?.width) return 0.5;
      const x = ((clientX - rect.left) / rect.width) * W;
      return clamp((x - L) / (W - L - R), 0, 1);
    },
    cancelDrawing: () => {
      gesture.current = null;
      setDraft(null);
      setHover(null);
    },
  });
  useEffect(() => {
    const el = dialog.current!;
    const active = document.activeElement as HTMLElement | null;
    el.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      el.close();
      document.body.style.overflow = overflow;
      active?.focus();
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(drawings));
      setNotice("");
    } catch {
      setNotice("브라우저 저장 공간이 부족해 그림을 저장하지 못했습니다.");
    }
  }, [drawings, storageKey]);
  function showSettings(selector: string) {
    controlOpener.current = document.activeElement as HTMLElement | null;
    gesture.current = null;
    setDraft(null);
    setControlPanel(
      selector === ".indicator-picker"
        ? "indicators"
        : selector === ".chart-drawing-settings"
          ? "drawing"
          : "display",
    );
  }
  function closeSettings(toCanvas = false) {
    setControlPanel(null);
    requestAnimationFrame(() => {
      if (toCanvas) canvas.current?.focus({ preventScroll: true });
      else if (controlOpener.current?.isConnected)
        controlOpener.current.focus({ preventScroll: true });
    });
  }
  function down(e: ReactPointerEvent<SVGSVGElement>) {
    if (pinching.current) return;
    if (!sync.ready || !bars.length || e.button !== 0 || !e.isPrimary) return;
    const p = coords(e);
    if (p.x < L || p.x > W - R || p.y < T || p.y > B) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(null);
    if (tool === "pan") {
      gesture.current = { kind: "pan", x: p.x, start: first };
      return;
    }
    if (tool === "select") return;
    if (drawings.length >= 200) {
      setNotice("그림은 종목·봉 종류별 최대 200개까지 저장할 수 있습니다.");
      return;
    }
    const point = anchorAt(p.x, p.y);
    const drawing: Drawing = {
      id: crypto.randomUUID(),
      tool,
      color,
      width,
      points: [point, point],
    };
    gesture.current = { kind: "draw", drawing };
    setDraft(drawing);
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    if (pinching.current) return;
    const p = coords(e);
    setHover(p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pan") {
      setStart(
        clamp(
          Math.round(g.start - (p.x - g.x) / step),
          0,
          Math.max(0, bars.length - shown),
        ),
      );
      return;
    }
    const point = anchorAt(p.x, p.y);
    const updated = {
      ...g.drawing,
      points:
        g.drawing.tool === "pen"
          ? [...g.drawing.points.slice(-599), point]
          : [g.drawing.points[0], point],
    };
    gesture.current = { kind: "draw", drawing: updated };
    setDraft(updated);
  }
  function finish(e: ReactPointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    gesture.current = null;
    setDraft(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (g?.kind === "draw") commit([...drawings, g.drawing]);
  }
  function shape(d: Drawing, hit = false) {
    const p = d.points[0],
      end = d.points.at(-1)!;
    const x1 = anchorX(p),
      y1 = scaleY(p.price),
      x2 = anchorX(end),
      y2 = scaleY(end.price);
    const props = {
      stroke: hit ? "transparent" : d.color,
      strokeWidth: hit ? 14 : d.width + (selected === d.id ? 1 : 0),
      fill: "none",
      vectorEffect: "non-scaling-stroke" as const,
      strokeLinecap: "round" as const,
      strokeLinejoin: "round" as const,
    };
    if (d.tool === "horizontal")
      return <line {...props} x1={L} x2={W - R} y1={y1} y2={y1} />;
    if (d.tool === "rectangle")
      return (
        <rect
          {...props}
          x={Math.min(x1, x2)}
          y={Math.min(y1, y2)}
          width={Math.max(1, Math.abs(x2 - x1))}
          height={Math.max(1, Math.abs(y2 - y1))}
        />
      );
    if (d.tool === "pen")
      return (
        <polyline
          {...props}
          points={d.points
            .map((p) => anchorX(p) + "," + scaleY(p.price))
            .join(" ")}
        />
      );
    return <line {...props} x1={x1} y1={y1} x2={x2} y2={y2} />;
  }
  const hoveredIndex = clamp(
    Math.round(indexAt(hover?.x ?? W - R - step)),
    0,
    Math.max(0, bars.length - 1),
  );
  const hovered = bars[hoveredIndex];
  const tools: [Tool, string, typeof Move][] = [
    ["select", "선택", MousePointer2],
    ["pan", "이동", Move],
    ["trend", "추세선", TrendingUp],
    ["horizontal", "수평선", Minus],
    ["rectangle", "사각형", Square],
    ["pen", "자유선", PenLine],
  ];
  return (
    <dialog
      ref={dialog}
      className="advanced-chart chart-simplified"
      aria-labelledby={clipId + "title"}
      onCancel={(e) => {
        e.preventDefault();
        if (controlPanel) closeSettings();
        else if (tool !== "select") {
          setTool("select");
          gesture.current = null;
          setDraft(null);
        } else leave();
      }}
      onKeyDown={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        }
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          remove();
        }
      }}
    >
      <div className="chart-view-workspace" inert={controlPanel !== null}>
        <header className="advanced-header">
          <div>
            <h2 id={clipId + "title"} title={name + " " + symbol}>
              {name} <small>{symbol}</small>
            </h2>
            <p>
              차트 분석실 · {source === "demo" ? "샘플 데이터" : "KIS 시세"}
            </p>
          </div>
          <div className="advanced-period">
            {[
              ["D", "일봉"],
              ["W", "주봉"],
              ["M", "월봉"],
            ].map(([p, label]) => (
              <button
                key={p}
                aria-pressed={period === p}
                className={period === p ? "active" : ""}
                disabled={sync.saving || sync.dirty}
                onClick={() => onPeriod(p)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="advanced-close"
            aria-label="차트 자세히 보기 닫기"
            onClick={leave}
          >
            <X size={22} />
          </button>
        </header>
        <div className="advanced-indicators">
          <div
            className="chart-view-modes"
            role="group"
            aria-label="차트 보기 방식"
          >
            <button
              type="button"
              aria-pressed={simple}
              onClick={() => setSimple(true)}
            >
              기본 차트
            </button>
            <button
              type="button"
              aria-pressed={!simple}
              onClick={() => setSimple(false)}
            >
              분석 차트
            </button>
          </div>
          <div className="zoom-actions">
            <button
              aria-label="차트 축소"
              disabled={
                zoomBusy || (shown >= bars.length && zoomOutPeriod === period)
              }
              title={
                zoomOutPeriod !== period
                  ? periodName(zoomOutPeriod) + "으로 전환하며 축소"
                  : "차트 축소"
              }
              onClick={() => zoom(1.4)}
            >
              <ZoomOut size={17} />
            </button>
            <button
              aria-label="차트 확대"
              disabled={zoomBusy || (shown <= 10 && zoomInPeriod === period)}
              title={
                zoomInPeriod !== period
                  ? periodName(zoomInPeriod) + "으로 전환하며 확대"
                  : "차트 확대"
              }
              onClick={() => zoom(0.7)}
            >
              <ZoomIn size={17} />
            </button>
            <button
              aria-label="차트 범위 초기화"
              onClick={() => {
                setCount(bars.length);
                setStart(0);
              }}
            >
              <RotateCcw size={16} />
            </button>
            <span>
              {visible.length} / {bars.length}개 봉
            </span>
          </div>
        </div>
        {initialWindow && (
          <div
            className="chart-window-status"
            role={windowError ? "alert" : "status"}
          >
            {windowLoading
              ? `${periodName(period)}으로 전환 중 · ${initialWindow.anchor} 주변 시세 조회`
              : windowError ||
                `${periodName(period)} 전환 · ${initialWindow.anchor} 주변 구간`}
            {windowError && (
              <button onClick={() => setWindowRetry((v) => v + 1)}>
                구간 다시 조회
              </button>
            )}
            {!windowLoading && (
              <button onClick={() => onPeriod(period)}>최근 구간 보기</button>
            )}
          </div>
        )}
        {hovered && (
          <div className="chart-price-summary">
            <div>
              <small>{hovered.date} 종가</small>
              <strong>
                {hovered.close.toLocaleString()}
                <small>원</small>
              </strong>
            </div>
            <span>
              {source === "demo" && "가상 시세 · "}
              {simple
                ? `가격·거래량 · 20${period === "M" ? "개월" : period === "W" ? "주" : "일"}선`
                : `보조지표 ${indicators.length}개`}
            </span>
          </div>
        )}
        {tool !== "select" && (
          <div className="chart-active-tool" role="status">
            <span>{tools.find(([key]) => key === tool)?.[1]} 모드</span>
            <button
              type="button"
              aria-label="실행 취소"
              disabled={!history.length}
              onClick={undo}
            >
              <Undo2 size={17} />
            </button>
            <button
              type="button"
              aria-label="다시 실행"
              disabled={!future.length}
              onClick={redo}
            >
              <Redo2 size={17} />
            </button>
            <button
              type="button"
              onClick={() => {
                setTool("select");
                setSelected(null);
                gesture.current = null;
                setDraft(null);
              }}
            >
              그리기 종료
            </button>
          </div>
        )}
        <div
          ref={canvas}
          tabIndex={0}
          aria-label="차트 작업 영역"
          className="advanced-canvas"
          style={{ height: chartMinHeight, minHeight: chartMinHeight }}
        >
          {!bars.length ? (
            <div className="chart-empty">
              {windowError ||
                (windowLoading
                  ? "보고 있던 날짜의 시세를 불러오고 있어요…"
                  : error || "차트를 불러오고 있어요…")}
            </div>
          ) : (
            <svg
              ref={svg}
              data-testid="drawing-canvas"
              role="img"
              aria-label={name + " 분석 차트"}
              aria-describedby={clipId + "gestures"}
              viewBox={"0 0 " + W + " " + H}
              style={{
                cursor:
                  tool === "pan"
                    ? "grab"
                    : tool === "select"
                      ? "default"
                      : "crosshair",
                touchAction: tool === "select" ? "pan-y" : "none",
              }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={() => {
                gesture.current = null;
                setDraft(null);
              }}
              onPointerLeave={() => {
                if (!gesture.current) setHover(null);
              }}
            >
              <defs>
                <clipPath id={clipId}>
                  <rect x={L} y={T} width={W - R - L} height={B - T} />
                </clipPath>
              </defs>
              {Array.from({ length: 6 }, (_, i) => {
                const p = high - ((high - low) * i) / 5,
                  y = scaleY(p);
                return (
                  <g key={i}>
                    <line
                      x1={L}
                      x2={W - R}
                      y1={y}
                      y2={y}
                      stroke="var(--chart-grid)"
                      strokeDasharray="3 4"
                    />
                    <text
                      x={W - R + 12}
                      y={y + 4}
                      fill="var(--chart-label)"
                      fontSize={11}
                    >
                      {Math.round(p).toLocaleString()}
                    </text>
                  </g>
                );
              })}
              <g clipPath={"url(#" + clipId + ")"}>
                {activeIndicators.includes("bollinger") && (
                  <g data-testid="bollinger-band" pointerEvents="none">
                    <polygon
                      points={bandPoints}
                      fill="var(--band-fill)"
                      data-testid="bollinger-fill"
                    />
                    <polyline
                      points={linePoints(bollinger.upper)}
                      fill="none"
                      stroke="var(--band-upper)"
                      strokeWidth={2}
                    />
                    <polyline
                      points={linePoints(bollinger.middle)}
                      fill="none"
                      stroke="var(--band-middle)"
                      strokeWidth={1.8}
                      strokeDasharray="6 4"
                    />
                    <polyline
                      points={linePoints(bollinger.lower)}
                      fill="none"
                      stroke="var(--band-lower)"
                      strokeWidth={2}
                    />
                  </g>
                )}
                {visible.map((b, i) => {
                  const x = L + (i + 0.5) * step,
                    c = b.close >= b.open ? "var(--up)" : "var(--down)";
                  return (
                    <g key={b.date}>
                      <line
                        x1={x}
                        x2={x}
                        y1={scaleY(b.high)}
                        y2={scaleY(b.low)}
                        stroke={c}
                      />
                      <rect
                        x={x - step * 0.3}
                        y={Math.min(scaleY(b.open), scaleY(b.close))}
                        width={Math.max(1, step * 0.6)}
                        height={Math.max(
                          1,
                          Math.abs(scaleY(b.open) - scaleY(b.close)),
                        )}
                        fill={c}
                      />
                    </g>
                  );
                })}
                {periods.map(
                  (n, i) =>
                    displayedAverages.includes(n) &&
                    !(n === 20 && activeIndicators.includes("bollinger")) && (
                      <polyline
                        key={n}
                        fill="none"
                        stroke={maColors[i]}
                        strokeWidth={1.5}
                        points={movingAverages[i]
                          .slice(first, first + shown)
                          .map((p, j) =>
                            p === null
                              ? ""
                              : L + (j + 0.5) * step + "," + scaleY(p),
                          )
                          .filter(Boolean)
                          .join(" ")}
                      />
                    ),
                )}
                {activeIndicators.includes("ema") && (
                  <polyline
                    data-testid="ema-line"
                    points={linePoints(ema20)}
                    fill="none"
                    stroke="var(--indicator-purple)"
                    strokeWidth={2}
                    strokeDasharray="8 3"
                  />
                )}
                {drawings.map((d) => (
                  <g
                    key={d.id}
                    data-drawing-id={d.id}
                    onPointerDown={(e) => {
                      if (tool === "select") {
                        e.stopPropagation();
                        setSelected(d.id);
                      }
                    }}
                    style={{
                      cursor: tool === "select" ? "pointer" : undefined,
                      pointerEvents: tool === "select" ? "auto" : "none",
                    }}
                  >
                    {shape(d)}
                    {shape(d, true)}
                  </g>
                ))}
                {draft && <g pointerEvents="none">{shape(draft)}</g>}
                {hover &&
                  hover.x >= L &&
                  hover.x <= W - R &&
                  hover.y >= T &&
                  hover.y <= B && (
                    <g pointerEvents="none">
                      <line
                        x1={hover.x}
                        x2={hover.x}
                        y1={T}
                        y2={B}
                        stroke="var(--chart-crosshair)"
                        strokeDasharray="4 4"
                      />
                      <line
                        x1={L}
                        x2={W - R}
                        y1={hover.y}
                        y2={hover.y}
                        stroke="var(--chart-crosshair)"
                        strokeDasharray="4 4"
                      />
                    </g>
                  )}
              </g>
              <text
                x={L}
                y={volumeTop - 12}
                fill="var(--chart-label)"
                fontSize={11}
              >
                거래량
              </text>
              <line
                x1={L}
                x2={W - R}
                y1={volumeTop - 4}
                y2={volumeTop - 4}
                stroke="var(--chart-grid)"
              />
              {visible.map((b, i) => {
                const x = L + (i + 0.5) * step,
                  h =
                    (b.volume / Math.max(1, ...visible.map((x) => x.volume))) *
                    (volumeBottom - volumeTop);
                return (
                  <g key={b.date}>
                    <rect
                      x={x - step * 0.3}
                      y={volumeBottom - h}
                      width={Math.max(1, step * 0.6)}
                      height={h}
                      fill={b.close >= b.open ? "var(--up)" : "var(--down)"}
                      opacity={0.45}
                    />
                    {i %
                      Math.max(
                        1,
                        Math.floor(shown / Math.max(2, Math.floor(W / 160))),
                      ) ===
                      0 && (
                      <text
                        x={x}
                        y={H - 16}
                        textAnchor={
                          i === 0 ? "start" : x > W - R - 40 ? "end" : "middle"
                        }
                        fill="var(--chart-label)"
                        fontSize={10}
                      >
                        {b.date}
                      </text>
                    )}
                  </g>
                );
              })}
              {panels.map((panel, panelIndex) => {
                const top = volumeBottom + 48 + panelIndex * 144,
                  bottom = top + 86;
                const values = [
                  ...panel.lines.flatMap((line) =>
                    line.values.slice(first, first + shown),
                  ),
                  ...(panel.histogram?.slice(first, first + shown) ?? []),
                ].filter((v): v is number => v !== null);
                let min = Math.min(...values, ...panel.levels, 0),
                  max = Math.max(...values, ...panel.levels, 1);
                if (panel.key === "obv" && values.length) {
                  min = Math.min(...values);
                  max = Math.max(...values);
                }
                if (panel.bounds) [min, max] = panel.bounds;
                else {
                  const padding = Math.max(1, (max - min) * 0.08);
                  min -= padding;
                  max += padding;
                }
                const scale = (value: number) =>
                  bottom - ((value - min) / (max - min)) * (bottom - top);
                const tickCandidates = panel.bounds
                  ? panel.levels
                  : [...new Set([...panel.levels, min, max])];
                const ticks = tickCandidates.filter(
                  (value, i) =>
                    !tickCandidates
                      .slice(0, i)
                      .some(
                        (other) => Math.abs(scale(value) - scale(other)) < 16,
                      ),
                );
                const axis = (value: number) =>
                  Intl.NumberFormat("ko-KR", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(value);
                return (
                  <g
                    key={panel.key}
                    data-testid={panel.key + "-panel"}
                    pointerEvents="none"
                  >
                    <text
                      x={L}
                      y={top - 28}
                      fill="var(--app-text)"
                      fontSize={12}
                      fontWeight={600}
                    >
                      {panel.label}
                    </text>
                    <text x={L} y={top - 10} fontSize={11}>
                      {panel.lines.map((line, i) => (
                        <tspan
                          key={line.label}
                          dx={i ? 14 : 0}
                          fill={line.color}
                        >
                          {line.dashed ? "┄ " : "━ "}
                          {line.label}{" "}
                          {line.values[hoveredIndex] == null
                            ? "계산 대기"
                            : W < 600
                              ? axis(line.values[hoveredIndex]!)
                              : indicatorNumber(line.values[hoveredIndex])}
                        </tspan>
                      ))}
                    </text>
                    {panel.bounds && (
                      <>
                        <rect
                          x={L}
                          y={top}
                          width={W - L - R}
                          height={scale(panel.levels.at(-1)!) - top}
                          fill="var(--up)"
                          opacity={0.07}
                        />
                        <rect
                          x={L}
                          y={scale(panel.levels[0])}
                          width={W - L - R}
                          height={bottom - scale(panel.levels[0])}
                          fill="var(--down)"
                          opacity={0.07}
                        />
                      </>
                    )}
                    {ticks.map((level) => (
                      <g key={level}>
                        <line
                          x1={L}
                          x2={W - R}
                          y1={scale(level)}
                          y2={scale(level)}
                          stroke="var(--chart-grid)"
                          strokeDasharray="4 4"
                        />
                        <text
                          x={W - R + 8}
                          y={scale(level) + 4}
                          fill="var(--chart-label)"
                          fontSize={11}
                        >
                          {axis(level)}
                        </text>
                      </g>
                    ))}
                    {panel.histogram
                      ?.slice(first, first + shown)
                      .map((value, i) =>
                        value === null ? null : (
                          <rect
                            key={i}
                            x={L + (i + 0.25) * step}
                            y={Math.min(scale(0), scale(value))}
                            width={Math.max(1, step * 0.5)}
                            height={Math.max(
                              1,
                              Math.abs(scale(value) - scale(0)),
                            )}
                            fill={value >= 0 ? "var(--up)" : "var(--down)"}
                            opacity={0.45}
                          />
                        ),
                      )}
                    {panel.lines.map((line) => (
                      <polyline
                        key={line.label}
                        points={linePoints(line.values, scale)}
                        fill="none"
                        stroke={line.color}
                        strokeWidth={1.8}
                        strokeDasharray={line.dashed ? "6 3" : undefined}
                      />
                    ))}
                    {!values.length && (
                      <text
                        x={L + 8}
                        y={top + 45}
                        fill="var(--muted)"
                        fontSize={12}
                      >
                        계산에 필요한 봉이 부족합니다.
                      </text>
                    )}
                    {hover && hover.x >= L && hover.x <= W - R && (
                      <line
                        x1={hover.x}
                        x2={hover.x}
                        y1={top}
                        y2={bottom}
                        stroke="var(--chart-crosshair)"
                        strokeDasharray="3 4"
                      />
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
        <div className="chart-viewport-summary">
          {visible.length > 0 && (
            <span data-testid="chart-visible-dates">
              {visible[0].date} ~ {visible.at(-1)!.date}
            </span>
          )}
          <span>{visible.length}개 봉</span>
        </div>
        <p className="chart-quick-hint" id={clipId + "gestures"}>
          Ctrl + 휠 또는 두 손가락으로 확대·축소
        </p>
        {(pastError || notice || sync.error) && (
          <div className="chart-inline-notice" role="alert">
            {pastError || notice || sync.error}
            {sync.error && (
              <button
                type="button"
                onClick={sync.ready ? sync.retry : sync.reload}
              >
                저장 다시 시도
              </button>
            )}
          </div>
        )}
        <nav className="chart-bottom-tools" aria-label="차트 도구">
          <button
            type="button"
            onClick={() => showSettings(".indicator-picker")}
            aria-haspopup="dialog"
          >
            <SlidersHorizontal size={18} />
            보조지표
          </button>
          <button
            type="button"
            onClick={() => showSettings(".chart-drawing-settings")}
            aria-haspopup="dialog"
          >
            <PenLine size={18} />
            그리기
          </button>
          <button
            type="button"
            onClick={() => showSettings(".chart-display-settings")}
            aria-haspopup="dialog"
          >
            <Settings2 size={18} />
            차트 설정
          </button>
        </nav>
      </div>
      {controlPanel && (
        <div
          className="chart-control-backdrop"
          onClick={() => closeSettings()}
          aria-hidden="true"
        />
      )}
      <section
        className="chart-control-panel"
        hidden={!controlPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={clipId + "controls-title"}
      >
        <header className="chart-control-heading">
          <h3 id={clipId + "controls-title"} ref={controlTitle} tabIndex={-1}>
            {controlPanel === "indicators"
              ? "보조지표"
              : controlPanel === "drawing"
                ? "그리기 도구"
                : "차트 설정"}
          </h3>
          <button
            type="button"
            aria-label="차트 도구 닫기"
            onClick={() => closeSettings()}
          >
            <X size={20} />
          </button>
        </header>
        <details
          className="chart-drawing-settings"
          open={controlPanel === "drawing"}
          hidden={controlPanel !== "drawing"}
        >
          <summary>그리기 도구</summary>
          <div className="advanced-toolbar">
            <div
              className="draw-tools"
              role="group"
              aria-label="차트 그리기 도구"
            >
              {tools.map(([key, label, Icon]) => (
                <button
                  key={key}
                  title={label}
                  aria-pressed={tool === key}
                  className={tool === key ? "active" : ""}
                  onClick={() => {
                    setTool(key);
                    setSelected(null);
                    closeSettings(true);
                    canvas.current?.scrollIntoView({
                      block: "nearest",
                      behavior: "instant",
                    });
                  }}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <label className="draw-color">
              색상
              <input
                aria-label="그리기 색상"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
            <label className="draw-width">
              두께
              <select
                aria-label="선 두께"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}px
                  </option>
                ))}
              </select>
            </label>
            <div className="draw-actions">
              <button
                aria-label="실행 취소"
                title="실행 취소 (Ctrl+Z)"
                disabled={!history.length}
                onClick={undo}
              >
                <Undo2 size={17} />
              </button>
              <button
                aria-label="다시 실행"
                title="다시 실행 (Ctrl+Shift+Z)"
                disabled={!future.length}
                onClick={redo}
              >
                <Redo2 size={17} />
              </button>
              <button
                aria-label="선택한 그림 삭제"
                title="선택한 그림 삭제"
                disabled={!selected}
                onClick={remove}
              >
                <Trash2 size={17} />
              </button>
              <button disabled={!drawings.length} onClick={() => commit([])}>
                전체 지우기
              </button>
            </div>
          </div>
        </details>
        <details
          className="indicator-picker"
          open={controlPanel === "indicators"}
          hidden={controlPanel !== "indicators"}
        >
          <summary>
            보조지표 설정{" "}
            <span>{indicators.length}개 사용 중 · 펼쳐서 변경</span>
          </summary>
          <div className="chart-average-settings">
            <div>
              <span>이동평균</span>
              {periods.map((n, i) => (
                <label key={n} style={{ color: maColors[i] }}>
                  <input
                    type="checkbox"
                    checked={averages.includes(n)}
                    onChange={() => {
                      setSimple(false);
                      setAverages((v) =>
                        v.includes(n) ? v.filter((x) => x !== n) : [...v, n],
                      );
                    }}
                  />
                  <span>
                    {n}
                    {period === "M" ? "개월" : period === "W" ? "주" : "일"}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div
            className="indicator-presets"
            role="group"
            aria-label="지표 조합"
          >
            {(
              [
                ["기본", ["bollinger", "rsi"]],
                ["추세", ["ema", "macd"]],
                ["모멘텀", ["rsi", "stochastic", "cci"]],
                ["거래량", ["mfi", "obv"]],
                ["변동성", ["bollinger", "atr"]],
                ["모두 끄기", []],
              ] as [string, Indicator[]][]
            ).map(([label, keys]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setSimple(false);
                  setIndicators(keys);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="indicator-options">
            {["가격·추세", "모멘텀", "거래량", "변동성"].map((group) => (
              <fieldset key={group}>
                <legend>{group}</legend>
                {indicatorDefinitions
                  .filter((d) => d.group === group)
                  .map((d) => (
                    <label key={d.key}>
                      <input
                        type="checkbox"
                        checked={indicators.includes(d.key)}
                        aria-label={d.label}
                        onChange={() => {
                          setSimple(false);
                          setIndicators((values) =>
                            values.includes(d.key)
                              ? values.filter((key) => key !== d.key)
                              : [...values, d.key],
                          );
                        }}
                      />
                      <span>
                        <b>{d.label}</b>
                        <small>{d.help}</small>
                      </span>
                    </label>
                  ))}
              </fieldset>
            ))}
          </div>
          <p>
            기간은 현재 선택한 일봉·주봉·월봉의 개수입니다. 필요한 봉이 부족하면
            계산 대기로 표시합니다. 과매수·과매도는 반전을 보장하지 않습니다.
          </p>
          <p>
            계산 참고:{" "}
            <a
              href="https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide"
              target="_blank"
              rel="noreferrer"
            >
              Fidelity 지표 안내
            </a>{" "}
            ·{" "}
            <a
              href="https://www.tradingview.com/support/solutions/43000502332-stochastic-stoch/"
              target="_blank"
              rel="noreferrer"
            >
              스토캐스틱 계산식
            </a>
          </p>
        </details>
        {hovered && indicators.length > 0 && (
          <details
            className="chart-readout-details"
            hidden={controlPanel !== "indicators"}
          >
            <summary>보조지표 수치·볼린저밴드</summary>
            <section
              className="indicator-readouts"
              aria-label="선택 봉 보조지표 값"
            >
              {indicators.includes("bollinger") && (
                <div className="bollinger-readout">
                  <header>
                    <b>볼린저밴드(20,2)</b>
                    <span>{hovered.date} 기준</span>
                  </header>
                  <div className="band-values">
                    <span className="band-upper">
                      상단{" "}
                      <b>{indicatorNumber(bollinger.upper[hoveredIndex], 0)}</b>
                    </span>
                    <span className="band-middle">
                      중심{" "}
                      <b>
                        {indicatorNumber(bollinger.middle[hoveredIndex], 0)}
                      </b>
                    </span>
                    <span className="band-lower">
                      하단{" "}
                      <b>{indicatorNumber(bollinger.lower[hoveredIndex], 0)}</b>
                    </span>
                  </div>
                  {(() => {
                    const upper = bollinger.upper[hoveredIndex],
                      lower = bollinger.lower[hoveredIndex],
                      middle = bollinger.middle[hoveredIndex];
                    if (upper == null || lower == null || middle == null)
                      return <small>20개 봉부터 계산합니다.</small>;
                    const { percentB, bandwidth } = bollingerPosition(
                      hovered.close,
                      upper,
                      lower,
                      middle,
                    );
                    return (
                      <>
                        <div className="band-position" aria-hidden="true">
                          {percentB !== null && (
                            <i
                              style={{ left: clamp(percentB, 0, 100) + "%" }}
                            />
                          )}
                        </div>
                        <div className="band-scale">
                          <span>하단 0%</span>
                          <span>중심 50%</span>
                          <span>상단 100%</span>
                        </div>
                        <small>
                          밴드 위치(%B){" "}
                          {percentB === null
                            ? "계산 불가 · 밴드 폭 0"
                            : indicatorNumber(percentB) + "%"}{" "}
                          · 밴드 폭 {indicatorNumber(bandwidth)}%
                          {percentB !== null &&
                            (percentB > 100
                              ? " · 상단 밖"
                              : percentB < 0
                                ? " · 하단 밖"
                                : " · 밴드 안")}
                        </small>
                      </>
                    );
                  })()}
                </div>
              )}
              {(panels.length > 0 || indicators.includes("ema")) && (
                <details className="indicator-value-details">
                  <summary>
                    지표 값 상세{" "}
                    <span>{hovered.date} 기준 · 그래프 위에도 표시됩니다</span>
                  </summary>
                  <div className="indicator-readouts">
                    {indicators.includes("ema") && (
                      <div>
                        <b>EMA(20)</b>
                        <p className="indicator-value">
                          {indicatorNumber(ema20[hoveredIndex])} 원
                        </p>
                        <small>최근 종가에 더 큰 비중</small>
                      </div>
                    )}
                    {panels.map((panel) => (
                      <div key={panel.key} data-testid={panel.key + "-readout"}>
                        <b>{panel.label}</b>
                        <p className="indicator-value">
                          {panel.lines.map((line) => (
                            <span key={line.label}>
                              <i
                                style={{
                                  borderColor: line.color,
                                  borderTopStyle: line.dashed
                                    ? "dashed"
                                    : "solid",
                                }}
                              />
                              {line.label}{" "}
                              {indicatorNumber(line.values[hoveredIndex])}
                            </span>
                          ))}
                        </p>
                        <small>
                          {panel.key === "macd"
                            ? "히스토그램 " +
                              indicatorNumber(macd.histogram[hoveredIndex])
                            : panel.key === "obv"
                              ? "첫 봉 0 기준 · 방향을 비교하세요"
                              : panel.key === "atr"
                                ? "가격 방향과 무관한 변동폭"
                                : "참고선 " + panel.levels.join(" / ")}
                        </small>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </section>
          </details>
        )}
        <section
          className="chart-display-settings"
          hidden={controlPanel !== "display"}
        >
          <h4>확대·이동</h4>
          <div className="chart-period-zoom">
            <label>
              <input
                type="checkbox"
                checked={automaticPeriod}
                onChange={(e) => setAutomaticPeriod(e.target.checked)}
              />
              봉 자동 전환
            </label>
            <span>확대: 월봉 → 주봉 → 일봉 · 축소는 반대로</span>
          </div>
          <div className="advanced-range">
            <button
              onClick={loadPast}
              disabled={loadingPast || !hasPast || !bars.length}
            >
              {loadingPast
                ? "조회 중…"
                : hasPast
                  ? "과거 더 보기"
                  : "최초 데이터"}
            </button>
            <input
              aria-label="차트 표시 구간 이동"
              type="range"
              min={0}
              max={Math.max(0, bars.length - shown)}
              value={first}
              disabled={shown >= bars.length}
              onChange={(e) => setStart(Number(e.target.value))}
            />
            <span>{initialWindow ? "구간 끝" : "최근"}</span>
          </div>
          <p className="chart-gesture-hint">
            PC: Ctrl + 마우스 휠 · 모바일: 두 손가락을 벌리거나 모아 확대·축소
          </p>
          <h4>선택한 봉 상세</h4>
          {hovered && (
            <div className="advanced-ohlc">
              {hovered.date}
              <span>시 {hovered.open.toLocaleString()}</span>
              <span className="up">고 {hovered.high.toLocaleString()}</span>
              <span className="down">저 {hovered.low.toLocaleString()}</span>
              <span>종 {hovered.close.toLocaleString()}</span>
              <span>거래량 {hovered.volume.toLocaleString()}</span>
            </div>
          )}
          <footer className="advanced-footer">
            <span>
              {pastError || notice || sync.status} · 그림 {drawings.length}개
              {sync.error && (
                <>
                  <button onClick={sync.ready ? sync.retry : sync.reload}>
                    다시 시도
                  </button>
                  <button onClick={sync.reload}>서버 그림 다시 불러오기</button>
                </>
              )}
            </span>
            <span>
              {tool === "select"
                ? "그림을 클릭해 선택 · Delete로 삭제"
                : tool === "pan"
                  ? "확대 후 차트를 드래그해 이동"
                  : "차트 위에서 드래그해 그리기"}{" "}
              · 제공된 {bars.length}개 봉 범위
            </span>
          </footer>
        </section>
        {controlPanel === "indicators" && (
          <button
            type="button"
            className="chart-control-done"
            onClick={() => closeSettings()}
          >
            차트로 돌아가기
          </button>
        )}
      </section>
    </dialog>
  );
}
