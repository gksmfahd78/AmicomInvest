import type { Page } from "@playwright/test";
export async function chartPoint(page: Page, ratio = 0.5) {
  await page.locator(".advanced-chart").evaluate((el) => {
    const canvas = el.querySelector(".advanced-canvas") as HTMLElement;
    el.scrollTop = canvas.offsetTop - 150;
  });
  const svg = page.getByTestId("drawing-canvas");
  await svg.waitFor();
  return svg.evaluate((el, fraction) => {
    const box = el.getBoundingClientRect();
    const clip = el.querySelector("clipPath rect") as SVGRectElement;
    const view = (el as SVGSVGElement).viewBox.baseVal;
    return {
      x:
        box.left +
        ((clip.x.baseVal.value + clip.width.baseVal.value * fraction) /
          view.width) *
          box.width,
      y: box.top + 100,
    };
  }, ratio);
}
export async function shownCandles(page: Page) {
  return Number(
    (await page.locator(".zoom-actions").textContent())!.match(
      /(\d+)\s*\//,
    )![1],
  );
}
export async function ctrlWheel(page: Page, delta: number, ratio = 0.5) {
  const point = await chartPoint(page, ratio);
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Control");
  try {
    await page.mouse.wheel(0, delta);
  } finally {
    await page.keyboard.up("Control");
  }
  await frame(page);
}
async function frame(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
export async function pinchChart(
  page: Page,
  from: number,
  to: number,
  remainingFinger = false,
) {
  const point = await chartPoint(page);
  const cdp = await page.context().newCDPSession(page);
  const touches = (width: number) => [
    { x: point.x - width / 2, y: point.y, id: 0 },
    { x: point.x + width / 2, y: point.y, id: 1 },
  ];
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: touches(from).slice(0, 1),
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: touches(from),
    });
    await frame(page);
    for (const fraction of [0.25, 0.5, 0.75, 1]) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: touches(from + (to - from) * fraction),
      });
      await frame(page);
    }
    if (remainingFinger) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: touches(to).slice(0, 1),
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ ...touches(to)[0], y: point.y + 30 }],
      });
      await frame(page);
    }
  } finally {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await frame(page);
    await cdp.detach();
  }
}
