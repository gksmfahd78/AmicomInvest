import { openDetails, toggleChartSettings } from "./uiControls";
import { test, expect, type Page } from "@playwright/test";
import { indicatorDefinitions } from "../src/chartIndicators";
async function openChart(page: Page) {
  const r = await page.request.post("/api/register", {
    headers: { "X-Study-Client": "web" },
    data: {
      username: "chart_" + crypto.randomUUID().slice(0, 8),
      name: "차트 검증",
      password: "Study!2026",
      invite: "STUDY2026",
    },
  });
  expect(r.ok()).toBeTruthy();
  await page.goto("/");
  await page
    .getByRole("button", { name: "자세히 보기 · 그리기", exact: true })
    .click();
  await expect(page.getByTestId("drawing-canvas")).toBeVisible();
  await page.getByRole("button", { name: "분석 차트", exact: true }).click();
  await expect(page.locator(".advanced-footer")).toContainText("저장");
}
async function allIndicators(page: Page) {
  await toggleChartSettings(page, ".indicator-picker");
  for (const d of indicatorDefinitions)
    await page.getByRole("checkbox", { name: d.label, exact: true }).check();
  await toggleChartSettings(page, ".indicator-picker");
}
test("보조지표 9종·밴드 음영·테마·작은 화면과 설정 저장", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openChart(page);
  await expect(page.getByTestId("bollinger-fill")).toHaveAttribute(
    "points",
    /\d/,
  );
  await expect(page.locator(".bollinger-readout")).toContainText(
    "밴드 위치(%B)",
  );
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.locator(".advanced-chart").evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({
      path: `artifacts/indicators-default-${theme}.png`,
    });
  }
  await allIndicators(page);
  await expect(page.locator('[data-testid$="-panel"]')).toHaveCount(7);
  await expect(page.getByTestId("ema-line")).toHaveAttribute("points", /\d/);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page
          .locator(".advanced-chart")
          .evaluate((el) => el.scrollWidth - el.clientWidth),
      )
      .toBeLessThanOrEqual(1);
    const metrics = await page.getByTestId("drawing-canvas").evaluate((svg) => {
      const price = svg.querySelector("clipPath rect") as SVGRectElement;
      const panels = [...svg.querySelectorAll('[data-testid$="-panel"]')].map(
        (p) => (p as SVGGraphicsElement).getBBox(),
      );
      const view = (svg as SVGSVGElement).viewBox.baseVal;
      return {
        priceHeight: price.height.baseVal.value,
        badNumbers: /NaN|Infinity/.test(svg.innerHTML),
        clippedDates: [...svg.querySelectorAll("text")]
          .filter((el) => /^\d{4}-\d{2}-\d{2}$/.test(el.textContent || ""))
          .some((el) => {
            const b = el.getBBox();
            return b.x < 0 || b.x + b.width > view.width;
          }),
        overlaps: panels.some(
          (p, i) => i > 0 && p.y < panels[i - 1].y + panels[i - 1].height,
        ),
        clipped: panels.some((p) => p.x < 0 || p.x + p.width > view.width + 1),
      };
    });
    expect(metrics.priceHeight).toBeGreaterThanOrEqual(250);
    expect(metrics.badNumbers).toBe(false);
    expect(metrics.clippedDates).toBe(false);
    expect(metrics.overlaps).toBe(false);
    expect(metrics.clipped).toBe(false);
    if (width === 390) {
      await page
        .locator(".advanced-chart")
        .evaluate((el) => (el.scrollTop = 0));
      await page.screenshot({ path: "artifacts/indicators-mobile.png" });
      await toggleChartSettings(page, ".indicator-picker");
      await page.screenshot({ path: "artifacts/indicators-mobile-picker.png" });
      await toggleChartSettings(page, ".indicator-picker");
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator(".advanced-close").click();
  await page
    .getByRole("button", { name: "자세히 보기 · 그리기", exact: true })
    .click();
  await expect(page.locator('[data-testid$="-panel"]')).toHaveCount(7);
  await page
    .locator(".advanced-period")
    .getByRole("button", { name: "주봉", exact: true })
    .click();
  await expect(page.locator('[data-testid$="-panel"]')).toHaveCount(7);
  await expect(page.getByTestId("drawing-canvas")).toBeVisible();
  await toggleChartSettings(page, ".indicator-picker");
  await page
    .getByRole("group", { name: "지표 조합" })
    .getByRole("button", { name: "변동성", exact: true })
    .click();
  await expect(page.getByTestId("atr-panel")).toHaveCount(1);
  await expect(page.getByTestId("rsi-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "모두 끄기", exact: true }).click();
  await expect(page.locator('[data-testid$="-panel"]')).toHaveCount(0);
  await expect(page.getByTestId("bollinger-band")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("지표 변경 후 그림 작성·되돌리기와 값 탐색 유지", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openChart(page);
  await openDetails(page, ".chart-drawing-settings");
  await page
    .locator(".draw-tools")
    .getByRole("button", { name: "수평선", exact: true })
    .click();
  const svg = page.getByTestId("drawing-canvas");
  await svg.scrollIntoViewIfNeeded();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 180, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 100);
  await page.mouse.up();
  await expect(page.locator("[data-drawing-id]")).toHaveCount(1);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(page.locator("[data-drawing-id]")).toHaveCount(0);
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect(page.locator("[data-drawing-id]")).toHaveCount(1);
  await toggleChartSettings(page, ".indicator-picker");
  await page
    .getByRole("group", { name: "지표 조합" })
    .getByRole("button", { name: "모멘텀", exact: true })
    .click();
  await expect(page.locator("[data-drawing-id]")).toHaveCount(1);
  await toggleChartSettings(page, ".indicator-picker");
  await page.getByRole("button", { name: "차트 확대", exact: true }).click();
  await expect(page.locator("[data-drawing-id]")).toHaveCount(1);
});

test("짧은 시세에서 지표 계산 대기 표시와 유한한 차트 좌표", async ({
  page,
}) => {
  await page.route("**/api/stock/*", async (route) => {
    const r = await route.fetch(),
      data = await r.json();
    await route.fulfill({
      json: { ...data, candles: data.candles?.slice(0, 5) },
    });
  });
  await openChart(page);
  await allIndicators(page);
  await expect(page.locator(".bollinger-readout")).toContainText(
    "20개 봉부터 계산",
  );
  await expect(page.getByTestId("rsi-readout")).toContainText("계산 대기");
  await expect(page.getByTestId("macd-panel")).toContainText(
    "계산에 필요한 봉이 부족",
  );
  expect(
    await page
      .getByTestId("drawing-canvas")
      .evaluate((el) => /NaN|Infinity/.test(el.innerHTML)),
  ).toBe(false);
});

test("모바일 기본 50봉과 차트 위 손가락 세로 스크롤", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChart(page);
  await expect(page.locator(".zoom-actions")).toContainText("50 /");
  await expect(page.getByTestId("drawing-canvas")).toHaveCSS(
    "touch-action",
    "pan-y",
  );
  await allIndicators(page);
  const dialog = page.locator(".advanced-chart");
  await dialog.evaluate((el) => {
    const canvas = el.querySelector(".advanced-canvas") as HTMLElement;
    el.scrollTop = canvas.offsetTop - 150;
  });
  const before = await dialog.evaluate((el) => el.scrollTop);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 180, y: 650 }],
  });
  for (const y of [620, 560, 500, 440, 380, 300])
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 180, y }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => dialog.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(before + 100);
  await page.screenshot({ path: "artifacts/indicators-mobile-panels.png" });
  await cdp.detach();
});
