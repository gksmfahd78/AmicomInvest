import { useDrawingSync } from "./useDrawingSync";
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
  X,
} from "lucide-react";
import type { Candle } from "./types";
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
  onPeriod: (p: string) => void;
  onClose: () => void;
  error: string;
  source: string;
};
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
const periods = [5, 20, 60] as const;
const maColors = ["#42aa70", "#ed8050", "#a778e7"];
export default function AdvancedChart({
  bars: incomingBars,
  symbol,
  name,
  userId,
  period,
  onPeriod,
  onClose,
  error,
  source,
}: Props) {
  const [bars, setBars] = useState(incomingBars);
  const [loadingPast, setLoadingPast] = useState(false),
    [hasPast, setHasPast] = useState(true),
    [pastError, setPastError] = useState("");
  const initialized = useRef(incomingBars.length > 0);
  useEffect(() => {
    if (!incomingBars.length) return;
    setBars((old) =>
      [
        ...new Map([...old, ...incomingBars].map((b) => [b.date, b])).values(),
      ].sort((a, b) => a.date.localeCompare(b.date)),
    );
    if (!initialized.current) {
      setStart(Math.max(0, incomingBars.length - 100));
      initialized.current = true;
    }
  }, [incomingBars]);
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
    [count, setCount] = useState(100),
    [start, setStart] = useState(Math.max(0, incomingBars.length - 100)),
    [averages, setAverages] = useState<number[]>([5, 20, 60]);
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
  const W = size.width,
    H = size.height,
    L = 20,
    R = size.width < 600 ? 65 : 90,
    T = 30,
    B = H - 150,
    volumeTop = H - 115,
    volumeBottom = H - 40;
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
  const maValues = movingAverages.flatMap((v, i) =>
    averages.includes(periods[i])
      ? v.slice(first, first + shown).filter((n): n is number => n !== null)
      : [],
  );
  const high = Math.max(1, ...visible.map((b) => b.high), ...maValues) * 1.025,
    low =
      Math.min(...visible.map((b) => b.low), ...maValues, high * 0.98) * 0.975;
  const scaleY = (p: number) => T + ((high - p) / (high - low)) * (B - T);
  const priceAt = (y: number) => high - ((y - T) / (B - T)) * (high - low);
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
  function zoom(factor: number) {
    const next = clamp(
      Math.round(shown * factor),
      Math.min(10, bars.length),
      bars.length,
    );
    setCount(next);
    setStart(
      clamp(Math.round(first + shown / 2 - next / 2), 0, bars.length - next),
    );
  }
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
  function down(e: ReactPointerEvent<SVGSVGElement>) {
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
  const hovered =
    bars[
      clamp(
        Math.round(indexAt(hover?.x ?? W - R - step)),
        0,
        Math.max(0, bars.length - 1),
      )
    ];
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
      className="advanced-chart"
      aria-labelledby={clipId + "title"}
      onCancel={(e) => {
        e.preventDefault();
        leave();
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
      <header className="advanced-header">
        <div>
          <h2 id={clipId + "title"}>
            {name} <small>{symbol}</small>
          </h2>
          <p>차트 분석실 · {source === "demo" ? "샘플 데이터" : "KIS 시세"}</p>
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
      <div className="advanced-toolbar">
        <div className="draw-tools" role="group" aria-label="차트 그리기 도구">
          {tools.map(([key, label, Icon]) => (
            <button
              key={key}
              title={label}
              aria-pressed={tool === key}
              className={tool === key ? "active" : ""}
              onClick={() => {
                setTool(key);
                setSelected(null);
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
      <div className="advanced-indicators">
        <div>
          이동평균{" "}
          {periods.map((n, i) => (
            <label key={n} style={{ color: maColors[i] }}>
              <input
                type="checkbox"
                checked={averages.includes(n)}
                onChange={() =>
                  setAverages((v) =>
                    v.includes(n) ? v.filter((x) => x !== n) : [...v, n],
                  )
                }
              />
              {n}
              {period === "M" ? "개월" : period === "W" ? "주" : "일"}
            </label>
          ))}
        </div>
        <div className="zoom-actions">
          <button
            aria-label="차트 축소"
            disabled={shown >= bars.length}
            onClick={() => zoom(1.4)}
          >
            <ZoomOut size={17} />
          </button>
          <button
            aria-label="차트 확대"
            disabled={shown <= 10}
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
      <div ref={canvas} className="advanced-canvas">
        {!bars.length ? (
          <div className="chart-empty">
            {error || "차트를 불러오고 있어요…"}
          </div>
        ) : (
          <svg
            ref={svg}
            data-testid="drawing-canvas"
            role="img"
            aria-label={name + " 분석 차트"}
            viewBox={"0 0 " + W + " " + H}
            style={{
              cursor:
                tool === "pan"
                  ? "grab"
                  : tool === "select"
                    ? "default"
                    : "crosshair",
              touchAction: "none",
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
                  averages.includes(n) && (
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
                      textAnchor="middle"
                      fill="var(--chart-label)"
                      fontSize={10}
                    >
                      {b.date}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <div className="advanced-range">
        <button
          onClick={loadPast}
          disabled={loadingPast || !hasPast || !bars.length}
        >
          {loadingPast ? "조회 중…" : hasPast ? "과거 더 보기" : "최초 데이터"}
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
        <span>최근</span>
      </div>
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
    </dialog>
  );
}
