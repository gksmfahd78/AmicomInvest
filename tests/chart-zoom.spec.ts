import { openDetails, toggleChartSettings } from "./uiControls";
import { test, expect, type Page } from "@playwright/test";
async function openChart(page: Page) {
  const response = await page.request.post("/api/register", {
    headers: { "X-Study-Client": "web" },
    data: {
      username: "zoom_" + crypto.randomUUID().slice(0, 8),
      name: "차트 전환 검증",
      password: "Study!2026",
      invite: "STUDY2026",
    },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/");
  await page
    .getByRole("button", { name: "자세히 보기 · 그리기", exact: true })
    .click();
  await expect(page.getByTestId("drawing-canvas")).toBeVisible();
  await page.getByRole("button", { name: "분석 차트", exact: true }).click();
  await expect(page.locator(".advanced-footer")).toContainText("계정에 저장됨");
}
const periodButton = (page: Page, name: string) =>
  page.locator(".advanced-period").getByRole("button", { name, exact: true });
async function weekly(page: Page) {
  await periodButton(page, "주봉").click();
  await expect(page.locator(".zoom-actions")).toContainText("200개 봉");
  await expect(periodButton(page, "주봉")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}
async function zoomToDaily(page: Page) {
  const zoom = page.getByRole("button", { name: "차트 확대", exact: true });
  for (let i = 0; i < 10; i++) {
    const title = await zoom.getAttribute("title");
    if (title?.includes("일봉")) {
      const range = await page.getByTestId("chart-visible-dates").innerText();
      const [from, to] = range.split(" ~ ").map((v) => Date.parse(v));
      const anchor = new Date((from + to) / 2).toISOString().slice(0, 10);
      await zoom.click();
      return anchor;
    }
    await zoom.click();
  }
  throw Error("일봉 전환 경계에 도달하지 못했습니다.");
}
async function assertAnchor(page: Page, anchor: string) {
  await expect(page.getByTestId("drawing-canvas")).toBeVisible();
  await expect(page.locator(".chart-window-status")).toContainText(
    anchor + " 주변 구간",
  );
  const [from, to] = (
    await page.getByTestId("chart-visible-dates").innerText()
  ).split(" ~ ");
  expect(from <= anchor && to >= anchor).toBe(true);
}
for (const width of [1440, 390])
  test(`확대·축소로 봉 자동 전환과 과거 중심 날짜 유지 (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const historyDates: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/history/") && r.url().includes("period=D"))
        historyDates.push(new URL(r.url()).searchParams.get("before")!);
    });
    await openChart(page);
    await weekly(page);
    // The oldest weekly window is years older than the default daily response.
    await openDetails(page, ".chart-display-settings");
    await page.getByLabel("차트 표시 구간 이동").fill("0");
    await toggleChartSettings(page, ".chart-display-settings");
    const anchor = await zoomToDaily(page);
    await expect(periodButton(page, "일봉")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await assertAnchor(page, anchor);
    expect(historyDates.length).toBeGreaterThan(0);
    expect(
      Math.abs(Date.parse(historyDates[0]) - Date.parse(anchor)),
    ).toBeLessThan(90 * 86400000);
    await expect(page.getByTestId("bollinger-band")).toHaveCount(1);
    for (const target of ["주봉", "월봉"]) {
      for (
        let i = 0;
        i < 12 &&
        (await periodButton(page, target).getAttribute("aria-pressed")) !==
          "true";
        i++
      )
        await page
          .getByRole("button", { name: "차트 축소", exact: true })
          .click();
      await expect(periodButton(page, target)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByTestId("drawing-canvas")).toBeVisible();
      const [from, to] = (
        await page.getByTestId("chart-visible-dates").innerText()
      ).split(" ~ ");
      expect(from <= anchor && to >= anchor).toBe(true);
    }
    await expect
      .poll(() =>
        page
          .locator(".advanced-chart")
          .evaluate((el) => el.scrollWidth - el.clientWidth),
      )
      .toBeLessThanOrEqual(1);
    await page.screenshot({ path: `artifacts/chart-zoom-${width}.png` });
    await page
      .getByRole("button", { name: "최근 구간 보기", exact: true })
      .click();
    await expect(page.locator(".chart-window-status")).toHaveCount(0);
    await expect(page.locator(".zoom-actions")).toContainText("200개 봉");
    expect(errors).toEqual([]);
  });
test("자동 전환 끄기와 재열기 후 설정 유지", async ({ page }) => {
  await openChart(page);
  await weekly(page);
  await openDetails(page, ".chart-display-settings");
  await page
    .getByRole("checkbox", { name: "봉 자동 전환", exact: true })
    .uncheck();
  await toggleChartSettings(page, ".chart-display-settings");
  const zoom = page.getByRole("button", { name: "차트 확대", exact: true });
  for (let i = 0; i < 15 && (await zoom.isEnabled()); i++) await zoom.click();
  await expect(zoom).toBeDisabled();
  await expect(periodButton(page, "주봉")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByRole("button", { name: "차트 자세히 보기 닫기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "자세히 보기 · 그리기", exact: true })
    .click();
  await openDetails(page, ".chart-display-settings");
  await expect(
    page.getByRole("checkbox", { name: "봉 자동 전환", exact: true }),
  ).not.toBeChecked();
});
test("주기 조회 중 이전 주봉이 일봉으로 표시되지 않는다", async ({ page }) => {
  await openChart(page);
  await weekly(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/stock/*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("period") === "D")
      await gate;
    await route.continue();
  });
  await periodButton(page, "일봉").click();
  await expect(page.getByTestId("drawing-canvas")).toHaveCount(0);
  await expect(page.locator(".advanced-chart .chart-empty")).toBeVisible();
  release();
  await expect(page.getByTestId("drawing-canvas")).toBeVisible();
  await expect(page.locator(".zoom-actions")).toContainText("200개 봉");
});
for (const empty of [false, true])
  test(`과거 시세 ${empty ? "없음" : "실패"} 시 최신 구간으로 이동하지 않고 재시도`, async ({
    page,
  }) => {
    await openChart(page);
    await weekly(page);
    let reject = true;
    await page.route("**/api/history/*", async (route) => {
      if (
        reject &&
        new URL(route.request().url()).searchParams.get("period") === "D"
      )
        await route.fulfill({
          status: empty ? 200 : 503,
          json: empty
            ? { candles: [], hasMore: false }
            : { error: "시세 조회 일시 실패" },
        });
      else await route.continue();
    });
    const anchor = await zoomToDaily(page);
    await expect(page.locator(".chart-window-status")).toHaveAttribute(
      "role",
      "alert",
    );
    await expect(page.getByTestId("drawing-canvas")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "차트 확대", exact: true }),
    ).toBeDisabled();
    reject = false;
    await page
      .getByRole("button", { name: "구간 다시 조회", exact: true })
      .click();
    await assertAnchor(page, anchor);
  });

test("그림 저장 중 자동 전환 방지와 주기별 그림 유지", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openChart(page);
  await weekly(page);
  await expect(page.locator(".advanced-footer")).toContainText("계정에 저장됨");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/drawings/*", async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  await openDetails(page, ".chart-drawing-settings");
  await page
    .locator(".draw-tools")
    .getByRole("button", { name: "수평선", exact: true })
    .click();
  const canvas = page.getByTestId("drawing-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 180, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 100);
  await page.mouse.up();
  await expect(page.locator("[data-drawing-id]")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "차트 확대", exact: true }),
  ).toBeDisabled();
  await expect(periodButton(page, "일봉")).toBeDisabled();
  release();
  await expect(page.locator(".advanced-footer")).toContainText("계정에 저장됨");
  const anchor = await zoomToDaily(page);
  await assertAnchor(page, anchor);
  await expect(page.locator("[data-drawing-id]")).toHaveCount(0);
  await periodButton(page, "주봉").click();
  await expect(page.locator("[data-drawing-id]")).toHaveCount(1);
});
