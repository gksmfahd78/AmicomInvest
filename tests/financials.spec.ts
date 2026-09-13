import { test, expect, type Page } from "@playwright/test";
import type { StockFinancials } from "../src/financialTypes";
const headers = { "X-Study-Client": "web" };
test.use({ hasTouch: true });
async function login(page: Page, path = "/?page=trade") {
  const configured = test.info().config.webServer;
  const server = Array.isArray(configured) ? configured[0] : configured;
  expect(server?.env?.MARKET_PROVIDER).toBe("demo");
  const r = await page.request.post("/api/login", {
    headers,
    data: {
      username: server?.env?.ADMIN_USERNAME,
      password: server?.env?.ADMIN_PASSWORD,
    },
  });
  expect(r.ok()).toBeTruthy();
  await page.goto(path);
}

test("재무 API는 인증·종목·조회 기간을 확인하며 ETF와 구분한다", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/financials/005930")).status()).toBe(401);
  await login(page);
  const annual = await page.request.get("/api/financials/005930?period=annual");
  expect(annual.ok()).toBeTruthy();
  const data: StockFinancials = await annual.json();
  expect(data).toMatchObject({
    symbol: "005930",
    period: "annual",
    source: "demo",
    amountUnit: "억원",
  });
  expect(data.rows.length).toBeGreaterThan(1);
  expect(
    (await page.request.get("/api/financials/005930?period=unknown")).ok(),
  ).toBeFalsy();
  expect((await page.request.get("/api/financials/999999")).ok()).toBeFalsy();
  expect((await page.request.get("/api/financials/069500")).status()).toBe(400);
});

test("분석을 열 때만 조회하며 재무표·추이가 PC와 모바일에서 잘리지 않는다", async ({
  page,
}) => {
  const errors: string[] = [];
  let requests = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/financials/")) requests++;
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await expect(page.locator(".chart-panel")).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "종목 분석", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "손익계산서", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".financial-demo")).toContainText(
    "실제 기업 실적이 아닙니다",
  );
  await expect(page.locator(".chart-panel")).not.toBeVisible();
  await expect(page.locator(".order-panel")).not.toBeVisible();
  for (const width of [1920, 1440, 1024, 850, 768, 601, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".trade-financials-panel")).toBeVisible();
    await expect(page.locator(".order-submit-bar")).not.toBeVisible();
    if (width > 600) {
      const stock = (await page.locator(".stock-panel").boundingBox())!;
      expect(stock.height).toBeLessThanOrEqual(868);
      const footer = (await page
        .locator(".stock-panel .stock-pagination")
        .boundingBox())!;
      expect(footer.y + footer.height).toBeLessThanOrEqual(
        stock.y + stock.height,
      );
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    for (const table of await page
      .locator(".financial-statement table")
      .all()) {
      expect(
        await table.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    await page.evaluate(() => scrollTo(0, 0));
    if ([1440, 390, 320].includes(width))
      await page.screenshot({
        path: `artifacts/financials-${width}.png`,
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "분기 누적", exact: true }).click();
  await expect(page.locator(".financial-basis")).toContainText(
    "단일 분기 실적과 구분",
  );
  await expect(page.locator(".financial-earnings h3")).toContainText(
    "누적 실적",
  );
  const last = page.locator(".financial-bars button").last();
  const initial = await page
    .getByLabel("기준 결산", { exact: true })
    .inputValue();
  await page.locator(".financial-bars button").first().click();
  await expect(page.getByLabel("기준 결산", { exact: true })).not.toHaveValue(
    initial,
  );
  await last.click();
  await expect(page.getByLabel("기준 결산", { exact: true })).toHaveValue(
    initial,
  );
  await page
    .getByLabel("비교 결산", { exact: true })
    .selectOption({ index: 1 });
  await expect(
    page
      .getByRole("table", { name: "재무상태표", exact: true })
      .locator("thead"),
  ).toContainText("기준");
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "종목 분석", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});

test("종목 변경 시 분석을 유지하고 ETF는 재무 수치 대신 상품 정보를 보여준다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "/?page=trade&tab=financials");
  await expect(page.locator(".financial-heading")).toContainText(
    "삼성전자 종목 분석",
  );
  await page.getByRole("button", { name: "종목 변경", exact: true }).click();
  await page.getByLabel("종목 검색").fill("000660");
  await page
    .getByRole("dialog", { name: "종목 탐색" })
    .locator(".stock-select")
    .click();
  await expect(
    page.getByRole("tab", { name: "종목 분석", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".financial-heading")).toContainText(
    "SK하이닉스 종목 분석",
  );
  await page.getByRole("tab", { name: "주문", exact: true }).click();
  await expect(page.locator(".order-panel")).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("tab", { name: "종목 분석", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  let financialRequests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/financials/069500")) financialRequests++;
  });
  await page.goto("/?page=trade&tab=financials&symbol=069500");
  await expect(
    page.getByRole("region", { name: "ETF 상품 정보", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".financial-statement")).toHaveCount(0);
  expect(financialRequests).toBe(0);
});

test("부분 누락과 적자는 그대로 보여주며 조회 실패를 숨기지 않는다", async ({
  page,
}) => {
  await page.route("**/api/financials/005930?period=*", async (route) => {
    const response = await route.fetch();
    const data: StockFinancials = await response.json();
    data.rows[0].revenue = null;
    data.rows[0].netIncome = -500;
    data.rows[0].assets = null;
    data.sections.find((s) => s.kind === "balance")!.status = "error";
    await route.fulfill({ json: data });
  });
  await login(page, "/?page=trade&tab=financials");
  await expect(page.locator(".financial-notice")).toContainText(
    "재무상태표: 조회에 실패",
  );
  const income = page.getByRole("table", { name: "손익계산서", exact: true });
  await expect(
    income
      .getByRole("row", { name: /^매출액/ })
      .locator("td")
      .first(),
  ).toHaveText("—");
  await expect(
    income
      .getByRole("row", { name: /^당기순이익/ })
      .locator("td")
      .first(),
  ).toHaveText("-500");
  await page.route("**/api/financials/000660?period=*", (route) =>
    route.fulfill({ status: 503, json: { error: "재무자료 조회 지연" } }),
  );
  await page.goto("/?page=trade&tab=financials&symbol=000660");
  await expect(page.getByRole("alert")).toContainText("재무자료 조회 지연");
  await expect(page.locator(".financial-statement")).toHaveCount(0);
});
