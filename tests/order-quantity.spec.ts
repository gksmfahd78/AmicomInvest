import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import type { Account } from "../src/types";

const headers = { "X-Study-Client": "web" };
test.use({ hasTouch: true });

async function memberWithShares(
  page: Page,
  request: APIRequestContext,
  quantity: number,
) {
  const servers = test.info().config.webServer;
  const server = Array.isArray(servers) ? servers[0] : servers;
  expect(server?.env?.MARKET_PROVIDER).toBe("demo");
  const login = await page.request.post("/api/login", {
    headers,
    data: {
      username: server?.env?.ADMIN_USERNAME,
      password: server?.env?.ADMIN_PASSWORD,
    },
  });
  expect(login.ok()).toBeTruthy();
  const registration = await request.post("/api/register", {
    headers,
    data: {
      username: "quantity_" + crypto.randomUUID().slice(0, 8),
      name: "수량 선택 검증",
      password: crypto.randomUUID(),
      invite: server?.env?.STUDY_INVITE_CODE,
    },
  });
  expect(registration.ok()).toBeTruthy();
  const { user } = await registration.json();
  const grant = await page.request.post("/api/admin/grants", {
    headers,
    data: {
      userId: user.id,
      amount: 100000000,
      note: "수량 선택 검증",
      requestId: crypto.randomUUID(),
    },
  });
  expect(grant.ok()).toBeTruthy();
  await page.context().addCookies((await request.storageState()).cookies);
  if (quantity > 0) {
    const buy = await page.request.post("/api/orders", {
      headers,
      data: {
        symbol: "005930",
        side: "buy",
        type: "market",
        quantity,
        requestId: crypto.randomUUID(),
      },
    });
    expect(buy.ok()).toBeTruthy();
    expect((await buy.json()).order.filled_quantity).toBe(quantity);
  }
}

test("매도 비율은 미체결 예약을 제외하고 모든 화면 크기에서 입력된다", async ({
  page,
  request,
}) => {
  await memberWithShares(page, request, 100);
  const pending = await page.request.post("/api/orders", {
    headers,
    data: {
      symbol: "005930",
      side: "sell",
      type: "limit",
      quantity: 20,
      limitPrice: 100000000,
      requestId: crypto.randomUUID(),
    },
  });
  expect(pending.ok()).toBeTruthy();
  expect((await pending.json()).order.status).toBe("pending");
  await page.goto("/?page=trade&tab=order");
  await page
    .locator(".order-side")
    .getByRole("button", { name: "매도", exact: true })
    .click();
  await expect(page.locator(".order-available")).toContainText("80주");
  let submits = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/orders")
      submits++;
  });
  for (const width of [1440, 1024, 768, 601, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [label, value] of [
      ["25%", "20"],
      ["50%", "40"],
      ["최대", "80"],
    ]) {
      const button = page
        .locator(".order-panel .quantity-shortcuts")
        .getByRole("button", { name: label, exact: true });
      await button.click({ timeout: 5000 });
      await expect(page.getByLabel("주문 수량", { exact: true })).toHaveValue(
        value,
      );
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(button.locator("small")).toHaveText(value + "주");
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    if (width === 390)
      await page.screenshot({ path: "artifacts/sell-quantity-390.png" });
  }
  expect(submits).toBe(0);
  await page.getByLabel("주문 수량", { exact: true }).fill("81");
  await expect(
    page.locator('.order-quantity-shortcuts [aria-pressed="true"]'),
  ).toHaveCount(0);
  await expect(page.locator(".order-quantity-help")).toContainText(
    "매도 가능 수량은 80주",
  );
  await expect(
    page.getByRole("button", { name: "삼성전자 매도", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("주문 유형").selectOption("limit");
  await page.getByLabel("주문 가격", { exact: true }).fill("100000000");
  await page
    .locator(".quantity-shortcuts")
    .getByRole("button", { name: "최대", exact: true })
    .click();
  await expect(page.getByLabel("주문 수량", { exact: true })).toHaveValue("80");
  await page
    .getByRole("button", { name: "삼성전자 매도", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("접수되었습니다");
  const account: Account = await (
    await page.request.get("/api/account")
  ).json();
  expect(account.holdings.find((h) => h.symbol === "005930")?.reserved).toBe(
    100,
  );
  await expect(page.locator(".order-available")).toContainText("0주");
  await expect(page.locator(".order-quantity-help")).toContainText(
    "모두 매도 예약 중",
  );
  await expect(page.locator(".order-quantity-help")).toContainText(
    "보유 100주 · 매도 예약 100주",
  );
  await expect(
    page.locator(".order-quantity-shortcuts button:disabled"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "삼성전자 매도", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "미체결 주문 확인", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "미체결", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("소량 보유도 터치로 최소 1주를 선택하고 최대 매도를 체결한다", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await memberWithShares(page, request, 3);
  await page.goto("/?page=trade&tab=order");
  await page
    .locator(".order-side")
    .getByRole("button", { name: "매도", exact: true })
    .tap();
  await expect(page.locator(".mobile-order-budget")).toContainText(
    "매도 가능 수량3주",
  );
  const shortcuts = page.getByRole("group", { name: "주문 수량 비율" });
  for (const [name, shares] of [
    ["25%", "1"],
    ["50%", "1"],
    ["최대", "3"],
  ]) {
    const button = shortcuts.getByRole("button", { name, exact: true });
    await expect(button.locator("small")).toHaveText(shares + "주");
    await button.tap();
    await expect(page.getByLabel("주문 수량", { exact: true })).toHaveValue(
      shares,
    );
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(shortcuts.locator('[aria-pressed="true"]')).toHaveCount(1);
  }
  await expect(page.locator(".order-quantity-help")).toContainText(
    "1주 미만은 1주",
  );
  await page.getByRole("button", { name: "삼성전자 매도", exact: true }).tap();
  await expect(page.getByRole("status")).toContainText("모의 체결되었습니다");
  await expect(page.locator(".order-available")).toContainText("0주");
  await expect(shortcuts.locator("button:disabled")).toHaveCount(3);
  await expect(page.locator(".order-quantity-help")).toContainText(
    "삼성전자 보유 수량이 없어",
  );
  const account: Account = await (
    await page.request.get("/api/account")
  ).json();
  expect(account.holdings).toHaveLength(0);
  expect(account.orders[0]).toMatchObject({
    side: "sell",
    quantity: 3,
    filled_quantity: 3,
    status: "filled",
  });
});

test("보유하지 않은 종목의 매도는 안내하고 매수 비율 선택은 유지한다", async ({
  page,
  request,
}) => {
  await memberWithShares(page, request, 1);
  await page.goto("/?page=trade&symbol=000660&tab=order");
  const shortcuts = page.getByRole("group", { name: "주문 수량 비율" });
  await page
    .locator(".order-side")
    .getByRole("button", { name: "매도", exact: true })
    .click();
  await expect(page.locator(".order-quantity-help")).toContainText(
    "SK하이닉스 보유 수량이 없어",
  );
  await expect(shortcuts.locator("button:disabled")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "SK하이닉스 매도", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "보유 종목 확인", exact: true })
    .click();
  await expect(
    page.getByRole("table", { name: "보유 종목", exact: true }),
  ).toContainText("삼성전자");
  await page.goto("/?page=trade&symbol=000660&tab=order");
  await page.getByLabel("주문 유형").selectOption("limit");
  await expect(shortcuts.locator("button:disabled")).toHaveCount(3);
  await expect(page.locator(".order-quantity-help")).toContainText(
    "지정가를 입력하면",
  );
  await page.getByLabel("주문 가격", { exact: true }).fill("100000");
  const { available }: Account = await (
    await page.request.get("/api/account")
  ).json();
  const { tradingCosts } = await (await page.request.get("/api/meta")).json();
  const maxBuy = Math.floor(
    available / (100000 * (1 + tradingCosts.commissionBps / 10000)),
  );
  for (const [name, ratio] of [
    ["25%", 25],
    ["50%", 50],
    ["최대", 100],
  ] as const) {
    await shortcuts.getByRole("button", { name, exact: true }).click();
    await expect(page.getByLabel("주문 수량", { exact: true })).toHaveValue(
      String(Math.floor((maxBuy * ratio) / 100)),
    );
  }
  await page.getByLabel("주문 수량", { exact: true }).fill("1");
  await expect(shortcuts.locator('[aria-pressed="true"]')).toHaveCount(0);
});
