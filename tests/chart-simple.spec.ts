import { test, expect, type Page } from "@playwright/test";
import { openDetails } from "./uiControls";
async function openChart(page: Page) {
  const config = test.info().config.webServer,
    server = Array.isArray(config) ? config[0] : config;
  expect(server?.env?.MARKET_PROVIDER).toBe("demo");
  const response = await page.request.post("/api/login", {
    headers: { "X-Study-Client": "web" },
    data: {
      username: server?.env?.ADMIN_USERNAME,
      password: server?.env?.ADMIN_PASSWORD,
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto("/?page=trade");
  await page
    .getByRole("button", { name: "자세히 보기 · 그리기", exact: true })
    .click();
  await expect(page.getByTestId("drawing-canvas")).toBeVisible();
}
test("기본 차트는 지표를 숨기고 가격과 거래량에 집중하며 작은 화면에서도 도구가 보인다", async ({
  page,
}) => {
  await openChart(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("button", { name: "기본 차트", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("bollinger-band")).toHaveCount(0);
  await expect(page.locator('[data-testid$="-panel"]')).toHaveCount(0);
  await expect(page.locator(".chart-price-summary")).toContainText("20일선");
  for (const width of [1440, 768, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page
      .locator(".advanced-chart")
      .evaluate((element) => (element.scrollTop = 0));
    expect(
      await page
        .locator(".advanced-chart")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    await expect(page.locator(".chart-control-panel")).not.toBeVisible();
    const tools = await page.locator(".chart-bottom-tools").boundingBox();
    expect(tools!.y + tools!.height).toBeLessThanOrEqual(901);
    const canvas = await page.locator(".advanced-canvas").boundingBox();
    const period = await page.locator(".advanced-period").boundingBox();
    const close = await page.locator(".advanced-close").boundingBox();
    expect(close!.x).toBeGreaterThanOrEqual(period!.x + period!.width);
    expect(canvas!.y).toBeLessThan(250);
    expect(canvas!.height).toBeGreaterThanOrEqual(320);
    if ([1440, 390, 320].includes(width))
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        await page.screenshot({
          path: `artifacts/chart-simple-${width}-${theme}.png`,
        });
      }
  }
  expect(errors).toEqual([]);
});
test("설정은 한 패널에서 열리고 Escape는 도구만 닫으며 기존 지표 선택을 유지한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openChart(page);
  await openDetails(page, ".indicator-picker");
  await expect(page.locator(".chart-view-workspace")).toHaveAttribute(
    "inert",
    "",
  );
  await expect(page.locator(".chart-control-heading h3")).toBeFocused();
  await page
    .getByRole("group", { name: "지표 조합" })
    .getByRole("button", { name: "추세", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".advanced-chart")).toBeVisible();
  await expect(page.locator(".chart-control-panel")).not.toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "차트 도구" })
      .getByRole("button", { name: "보조지표", exact: true }),
  ).toBeFocused();
  await expect(page.getByTestId("ema-line")).toHaveCount(1);
  await expect(page.getByTestId("macd-panel")).toHaveCount(1);
  await page.getByRole("button", { name: "기본 차트", exact: true }).click();
  await expect(page.getByTestId("ema-line")).toHaveCount(0);
  await page.getByRole("button", { name: "분석 차트", exact: true }).click();
  await expect(page.getByTestId("macd-panel")).toHaveCount(1);
  await page
    .locator(".advanced-period")
    .getByRole("button", { name: "주봉", exact: true })
    .click();
  await expect(page.getByTestId("macd-panel")).toHaveCount(1);
  await openDetails(page, ".chart-display-settings");
  await expect(
    page.getByRole("checkbox", { name: "봉 자동 전환", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/chart-simple-settings-390.png" });
  await page
    .getByRole("button", { name: "차트 도구 닫기", exact: true })
    .click();
  await page.getByRole("button", { name: "기본 차트", exact: true }).click();
  await page.locator(".advanced-close").click();
  await page
    .getByRole("button", { name: "자세히 보기 · 그리기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "기본 차트", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
test("그리기 도구 선택 후 차트로 돌아오고 선택 모드로 종료할 수 있다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openChart(page);
  await openDetails(page, ".chart-drawing-settings");
  await page.screenshot({ path: "artifacts/chart-simple-drawing-320.png" });
  await page
    .getByRole("group", { name: "차트 그리기 도구" })
    .getByRole("button", { name: "추세선", exact: true })
    .click();
  await expect(page.locator(".chart-control-panel")).not.toBeVisible();
  await expect(page.locator(".advanced-canvas")).toBeFocused();
  await expect(page.locator(".chart-active-tool")).toContainText("추세선 모드");
  await page.screenshot({ path: "artifacts/chart-simple-active-tool-320.png" });
  await page.getByRole("button", { name: "그리기 종료", exact: true }).click();
  await expect(page.locator(".chart-active-tool")).toHaveCount(0);
  await expect(page.getByTestId("drawing-canvas")).toHaveCSS(
    "touch-action",
    "pan-y",
  );
  await openDetails(page, ".indicator-picker");
  await expect(page.locator(".chart-average-settings label>span")).toHaveText([
    "5일",
    "20일",
    "60일",
  ]);
  await page.screenshot({ path: "artifacts/chart-simple-indicators-320.png" });
  expect(
    await page
      .locator(".chart-control-panel")
      .evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
});
