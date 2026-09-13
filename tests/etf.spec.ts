import { openDetails } from "./uiControls";
import { test, expect } from "@playwright/test";
const runtimeErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  runtimeErrors.length = 0;
  page.on("pageerror", (e) => runtimeErrors.push(e.message));
});
test.afterEach(() => {
  expect(runtimeErrors).toEqual([]);
});

test("모바일에서 ETF 검색·NAV 확인·주문·정정·매도 비용이 이어진다", async ({
  page,
  request,
}) => {
  const headers = { "X-Study-Client": "web" };
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (
      await page.request.post("/api/login", {
        headers,
        data: { username: "admin", password: "Study!2026" },
      })
    ).ok(),
  ).toBeTruthy();
  const registration = await request.post("/api/register", {
    headers,
    data: {
      username: "etf_" + crypto.randomUUID().slice(0, 8),
      name: "ETF 검증",
      password: "Study!2026",
      invite: "STUDY2026",
    },
  });
  expect(registration.ok()).toBeTruthy();
  const { user } = await registration.json();
  expect(
    (
      await page.request.post("/api/admin/grants", {
        headers,
        data: {
          userId: user.id,
          amount: 10000000,
          note: "ETF 검증",
          requestId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.context().addCookies((await request.storageState()).cookies);
  const post = (data: object) =>
    page.request.post("/api/orders", {
      headers,
      data: {
        symbol: "069500",
        side: "buy",
        type: "limit",
        quantity: 2,
        note: "ETF 검증",
        requestId: crypto.randomUUID(),
        ...data,
      },
    });
  const spoofed = await post({
    symbol: "005930",
    instrument: "etf",
    sellTaxBps: 0,
    limitPrice: 25005,
  });
  expect(spoofed.ok()).toBe(false);
  expect((await spoofed.json()).error).toContain("50원");
  const snapshot = await (
    await page.request.get("/api/stock/069500?period=D")
  ).json();
  const limitPrice =
    Math.floor((snapshot.book.bids[0].price - 1000) / 50) * 50 + 5;
  const pending = await post({ limitPrice });
  expect(pending.ok()).toBeTruthy();
  const { order } = await pending.json();
  expect(order.status).toBe("pending");
  expect(order.instrument).toBe("etf");
  const amend = await page.request.post(`/api/orders/${order.id}/amend`, {
    headers,
    data: {
      quantity: 2,
      limitPrice: limitPrice + 5,
      expectedFilled: 0,
      requestId: crypto.randomUUID(),
    },
  });
  expect(amend.ok()).toBeTruthy();
  const amended = await amend.json();
  expect(amended.order.instrument).toBe("etf");
  expect(amended.order.sell_tax_bps).toBe(0);
  expect(
    (
      await page.request.post(`/api/orders/${amended.order.id}/cancel`, {
        headers,
      })
    ).ok(),
  ).toBeTruthy();
  expect((await post({ type: "market" })).ok()).toBeTruthy();
  const sell = await post({ type: "market", side: "sell", quantity: 1 });
  expect(sell.ok()).toBeTruthy();
  const sale = (await sell.json()).order;
  expect(sale.tax).toBe(0);
  expect(sale.fee).toBeGreaterThan(0);
  await page.goto("/");
  await page.getByRole("button", { name: "종목 변경", exact: true }).click();
  const picker = page.getByRole("dialog");
  await openDetails(page, ".stock-filters");
  await picker
    .getByRole("group", { name: "상품 유형 선택" })
    .getByRole("button", { name: "ETF", exact: true })
    .click();
  await expect(picker.locator(".stock-row").first()).toContainText("ETF");
  await picker
    .locator(".stock-select")
    .filter({ hasText: "KODEX 200" })
    .click();
  const info = page.getByRole("region", { name: "ETF 상품 정보" });
  await expect(info).toContainText("학습용 가상 수치");
  await expect(info).toContainText("+0.10%");
  await info.screenshot({ path: "artifacts/etf-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("tab", { name: "주문", exact: true }).click();
  await expect(page.locator(".etf-order-note")).toContainText(
    "매도 거래세 0원",
  );
  await page.getByRole("button", { name: "내 투자 계좌", exact: true }).click();
  await expect(
    page.locator(".holding-stock").filter({ hasText: "KODEX 200" }),
  ).toContainText("ETF");
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("ETF NAV 오류와 재시도, 미제공 수치를 0으로 숨기지 않는다", async ({
  page,
}) => {
  const headers = { "X-Study-Client": "web" };
  await page.request.post("/api/login", {
    headers,
    data: { username: "admin", password: "Study!2026" },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  let failed = true;
  await page.route("**/api/etf/069500", async (route) => {
    await route.fulfill({
      status: failed ? 503 : 200,
      json: failed
        ? { error: "조회 실패" }
        : {
            symbol: "069500",
            source: "kis",
            receivedAt: Date.now(),
            price: 10000,
            nav: null,
            premiumRate: null,
            multiplier: -1,
            category: null,
            referenceIndex: null,
            componentCount: null,
          },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "종목 변경", exact: true }).click();
  const picker = page.getByRole("dialog");
  await openDetails(page, ".stock-filters");
  await picker
    .getByRole("group", { name: "상품 유형 선택" })
    .getByRole("button", { name: "ETF", exact: true })
    .click();
  await picker
    .locator(".stock-select")
    .filter({ hasText: "KODEX 200" })
    .click();
  const info = page.getByRole("region", { name: "ETF 상품 정보" });
  await expect(info.getByRole("status")).toContainText("불러오지 못했습니다");
  failed = false;
  await info.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(info).toContainText("계산 불가");
  await expect(info).toContainText("여러 날의 누적 수익률");
  await expect(info).not.toContainText("0.00%");
  await page.setViewportSize({ width: 320, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
