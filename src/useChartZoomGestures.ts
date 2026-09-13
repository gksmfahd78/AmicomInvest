import { useEffect, useRef, type RefObject } from "react";

type Options = {
  zoom: (factor: number, anchorRatio: number) => void;
  anchorRatio: (clientX: number) => number;
  cancelDrawing: () => void;
};

export function useChartZoomGestures(
  container: RefObject<HTMLElement | null>,
  options: Options,
) {
  const latest = useRef(options);
  latest.current = options;
  const pinching = useRef(false);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let wheelFrame = 0,
      pinchFrame = 0,
      wheelPixels = 0,
      wheelX = 0,
      lastWheel = 0;
    let pinch: {
      ids: number[];
      distance: number;
      nextDistance: number;
      x: number;
    } | null = null;
    const limit = (factor: number) => Math.max(0.5, Math.min(2, factor));
    const prevent = (event: Event) => {
      if (event.cancelable) event.preventDefault();
    };
    function wheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) {
        wheelPixels = 0;
        cancelAnimationFrame(wheelFrame);
        wheelFrame = 0;
        return;
      }
      // Non-passive listeners prevent browser zoom only inside the chart.
      prevent(event);
      if (pinching.current || !Number.isFinite(event.deltaY)) return;
      const now = performance.now();
      if (now - lastWheel > 180) wheelPixels = 0;
      lastWheel = now;
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element!.clientHeight
            : 1;
      wheelPixels += event.deltaY * unit;
      wheelX = event.clientX;
      if (wheelFrame) return;
      wheelFrame = requestAnimationFrame(() => {
        wheelFrame = 0;
        // Accumulate small trackpad deltas instead of rounding each one away.
        if (Math.abs(wheelPixels) < 40) return;
        const factor = limit(
          Math.exp(Math.max(-240, Math.min(240, wheelPixels)) * 0.003),
        );
        wheelPixels = 0;
        latest.current.zoom(factor, latest.current.anchorRatio(wheelX));
      });
    }
    const distance = (a: Touch, b: Touch) =>
      Math.max(8, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
    function start(event: TouchEvent) {
      if (pinching.current) {
        prevent(event);
        return;
      }
      if (event.touches.length !== 2) return;
      const [a, b] = Array.from(event.touches);
      if (
        !element!.contains(a.target as Node) ||
        !element!.contains(b.target as Node)
      )
        return;
      prevent(event);
      pinching.current = true;
      cancelAnimationFrame(wheelFrame);
      wheelFrame = 0;
      wheelPixels = 0;
      latest.current.cancelDrawing();
      const d = distance(a, b);
      pinch = {
        ids: [a.identifier, b.identifier],
        distance: d,
        nextDistance: d,
        x: (a.clientX + b.clientX) / 2,
      };
    }
    function applyPinch() {
      pinchFrame = 0;
      if (!pinch) return;
      const factor = pinch.distance / pinch.nextDistance;
      if (Math.abs(Math.log(factor)) < 0.06) return;
      pinch.distance = pinch.nextDistance;
      latest.current.zoom(limit(factor), latest.current.anchorRatio(pinch.x));
    }
    function move(event: TouchEvent) {
      if (!pinching.current || !pinch) return;
      prevent(event);
      if (event.touches.length !== 2) return;
      const touches = Array.from(event.touches);
      const a = touches.find((t) => t.identifier === pinch!.ids[0]);
      const b = touches.find((t) => t.identifier === pinch!.ids[1]);
      if (!a || !b) return;
      pinch.nextDistance = distance(a, b);
      pinch.x = (a.clientX + b.clientX) / 2;
      if (!pinchFrame) pinchFrame = requestAnimationFrame(applyPinch);
    }
    function end(event: TouchEvent) {
      if (!pinching.current) return;
      prevent(event);
      // The remaining finger must not become a drawing or drag after a pinch.
      if (event.touches.length) return;
      cancelAnimationFrame(pinchFrame);
      applyPinch();
      pinch = null;
      pinching.current = false;
      latest.current.cancelDrawing();
    }
    function cancel() {
      cancelAnimationFrame(pinchFrame);
      pinchFrame = 0;
      pinch = null;
      pinching.current = false;
      latest.current.cancelDrawing();
    }
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("touchstart", start, { passive: false });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end, { passive: false });
    element.addEventListener("touchcancel", cancel);
    return () => {
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", cancel);
      cancelAnimationFrame(wheelFrame);
      cancelAnimationFrame(pinchFrame);
      pinching.current = false;
    };
  }, [container]);
  return pinching;
}
