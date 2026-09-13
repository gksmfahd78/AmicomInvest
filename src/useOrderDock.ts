import { useEffect } from "react";
export function useOrderDock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const visibility = () => {
      const dock = document.querySelector<HTMLElement>(".order-submit-bar");
      const panel = document.querySelector(".order-panel");
      if (!dock || !panel) return;
      dock.classList.toggle(
        "outside-order",
        panel.getBoundingClientRect().bottom <=
          dock.getBoundingClientRect().top + 16,
      );
    };
    const update = () => {
      const inset = viewport
        ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      document.documentElement.style.setProperty(
        "--keyboard-inset",
        inset + "px",
      );
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(visibility);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("scroll", visibility, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("scroll", visibility);
      window.removeEventListener("resize", update);
      document
        .querySelector(".order-submit-bar")
        ?.classList.remove("outside-order");
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, [active]);
}
