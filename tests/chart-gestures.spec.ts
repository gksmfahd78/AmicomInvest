import { openDetails } from "./uiControls";
import { test, expect, type Page } from "@playwright/test";
import {
  chartPoint,
  ctrlWheel,
  pinchChart,
  shownCandles,
} from "./chartGestureHelpers";
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});
test.afterEach(({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});
async function openChart(page: Page) {
  const r = await page.request.post("/api/register", {
    headers: { "X-Study-Client": "web" },
    data: {
      username: "gesture_" + crypto.randomUUID().slice(0, 8),
      name: "차트 제스처 검증",
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
  await expect(page.locator(".advanced-footer")).toContainText("계정에 저장됨");
}
const periodButton = (page: Page, name: string) =>
  page.locator(".advanced-period").getByRole("button", { name, exact: true });
const pageScale = (page: Page) =>
  page.evaluate(() => ({
    scale: visualViewport?.scale,
    dpr: devicePixelRatio,
  }));
async function anchorDate(page: Page, ratio: number) {
  const [from, to] = (await page.getByTestId("chart-visible-dates").innerText())
    .split(" ~ ")
    .map(Date.parse);
  return new Date(from + (to - from) * ratio).toISOString().slice(0, 10);
}
test("Ctrl+휠은 마우스 위치를 유지해 확대·축소하고 일반 휠은 스크롤", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openChart(page);
  const scale = await pageScale(page),
    before = await shownCandles(page),
    anchor = await anchorDate(page, 0.25);
  await ctrlWheel(page, -120, 0.25);
  await expect.poll(() => shownCandles(page)).toBeLessThan(before);
  const after = await shownCandles(page);
  expect(
    Math.abs(Date.parse(await anchorDate(page, 0.25)) - Date.parse(anchor)),
  ).toBeLessThanOrEqual(2 * 86400000);
  await ctrlWheel(page, 120, 0.25);
  await expect.poll(() => shownCandles(page)).toBeGreaterThan(after);
  expect(await pageScale(page)).toEqual(scale);
  // The basic chart fits the viewport; use a shorter analysis view to verify scrolling.
  await page.setViewportSize({ width: 1440, height: 760 });
  await page.getByRole("button", { name: "분석 차트", exact: true }).click();
  const point = await chartPoint(page);
  await page.mouse.move(point.x, point.y);
  const scroll = await page
      .locator(".advanced-chart")
      .evaluate((el) => el.scrollTop),
    count = await shownCandles(page);
  await page.mouse.wheel(0, -180);
  await expect
    .poll(() => page.locator(".advanced-chart").evaluate((el) => el.scrollTop))
    .toBeLessThan(scroll);
  expect(await shownCandles(page)).toBe(count);
});
test("Ctrl+휠로 주봉→일봉·일봉→주봉 전환과 날짜 유지", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openChart(page);
  await periodButton(page, "주봉").click();
  await expect(page.getByTestId("drawing-canvas")).toBeVisible();
  let anchor = "";
  for (
    let i = 0;
    i < 12 &&
    (await periodButton(page, "일봉").getAttribute("aria-pressed")) !== "true";
    i++
  ) {
    anchor = await anchorDate(page, 0.25);
    await ctrlWheel(page, -120, 0.25);
  }
  await expect(periodButton(page, "일봉")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".chart-window-status")).toContainText(
    anchor + " 주변 구간",
  );
  for (
    let i = 0;
    i < 16 &&
    (await periodButton(page, "주봉").getAttribute("aria-pressed")) !== "true";
    i++
  )
    await ctrlWheel(page, 120);
  await expect(periodButton(page, "주봉")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("drawing-canvas")).toBeVisible();
});
test.describe("모바일 두 손가락", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("벌리기·모으기로 차트만 확대·축소하고 남은 손가락은 그림을 남기지 않는다", async ({
    page,
  }) => {
    await openChart(page);
    const scale = await pageScale(page),
      before = await shownCandles(page);
    await pinchChart(page, 80, 150);
    await expect.poll(() => shownCandles(page)).toBeLessThan(before);
    const after = await shownCandles(page);
    await pinchChart(page, 150, 80);
    await expect.poll(() => shownCandles(page)).toBeGreaterThan(after);
    expect(await pageScale(page)).toEqual(scale);
    await openDetails(page, ".chart-drawing-settings");
    await page
      .locator(".draw-tools")
      .getByRole("button", { name: "수평선", exact: true })
      .click();
    await pinchChart(page, 80, 150, true);
    await expect(page.locator("[data-drawing-id]")).toHaveCount(0);
    expect(await pageScale(page)).toEqual(scale);
    await openDetails(page, ".chart-drawing-settings");
    await page
      .locator(".draw-tools")
      .getByRole("button", { name: "선택", exact: true })
      .click();
    await expect(page.getByTestId("drawing-canvas")).toHaveCSS(
      "touch-action",
      "pan-y",
    );
  });
  test("두 손가락 확대로 주봉에서 일봉으로 전환", async ({ page }) => {
    await openChart(page);
    await periodButton(page, "주봉").click();
    await expect(page.getByTestId("drawing-canvas")).toBeVisible();
    for (
      let i = 0;
      i < 8 &&
      (await periodButton(page, "일봉").getAttribute("aria-pressed")) !==
        "true";
      i++
    )
      await pinchChart(page, 80, 150);
    await expect(periodButton(page, "일봉")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("drawing-canvas")).toBeVisible();
    await expect(page.locator(".chart-window-status")).toContainText(
      "주변 구간",
    );
    expect((await pageScale(page)).scale).toBe(1);
  });
});
