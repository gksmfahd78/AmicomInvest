import { test, expect } from "@playwright/test";

test("모바일 체결 상세에 당시 호가와 모의 잔량 근거가 표시된다", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const headers = { "X-Study-Client": "web" };
  await page.goto("/");
  await page.getByLabel("아이디", { exact: true }).fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "차트", exact: true }),
  ).toBeVisible();
  const { user } = await (
    await request.post("/api/register", {
      headers,
      data: {
        username: "fills_" + crypto.randomUUID().slice(0, 8),
        name: "체결 근거 검증",
        password: "Study!2026",
        invite: "STUDY2026",
      },
    })
  ).json();
  expect(
    (
      await page.request.post("/api/admin/grants", {
        headers,
        data: {
          userId: user.id,
          amount: 10000000,
          note: "체결 근거 검증",
          requestId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.context().addCookies((await request.storageState()).cookies);
  const response = await page.request.post("/api/orders", {
    headers,
    data: {
      symbol: "005930",
      side: "buy",
      type: "market",
      quantity: 2,
      note: "체결 근거 검증",
      requestId: crypto.randomUUID(),
    },
  });
  expect(response.ok()).toBeTruthy();
  const account = await (await page.request.get("/api/account")).json();
  expect(account.orders[0].fills[0].execution_note).toContain("모의 잔량");
  await page.reload();
  await page.getByRole("button", { name: "내 투자 계좌", exact: true }).click();
  await page.getByRole("tab", { name: "체결 내역", exact: true }).click();
  const row = page
    .getByRole("table", { name: "주문 내역", exact: true })
    .locator("tbody tr")
    .filter({ hasText: "체결 근거 검증" });
  await row.getByRole("button", { name: /주문 .* 상세/ }).click();
  await row.locator(".fill-details summary").click();
  await expect(row.locator(".fill-evidence")).toContainText(
    "배분 전 모의 잔량",
  );
  await expect(row.locator(".fill-evidence")).toContainText("최우선 상대 호가");
  await expect(row.locator(".fill-evidence")).toContainText("호가 수신");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await row.screenshot({ path: "artifacts/execution-evidence-mobile.png" });
});

test("거래 상태가 VI이면 주문 버튼과 보류 이유를 함께 표시한다", async ({
  page,
}) => {
  const now = new Date("2026-09-10T10:00:00+09:00");
  await page.clock.setFixedTime(now);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/meta", async (route) => {
    const r = await route.fetch();
    const body = await r.json();
    await route.fulfill({ response: r, json: { ...body, provider: "kis" } });
  });
  await page.route("**/api/stock/*?period=*", async (route) => {
    const r = await route.fetch();
    const body = await r.json();
    await route.fulfill({
      response: r,
      json: {
        ...body,
        book: { ...body.book, receivedAt: now.getTime(), marketPhase: "20" },
        execution: {
          phase: "vi",
          canTrade: false,
          reason:
            "VI 발동 중입니다. 제공처에서 해제가 확인될 때까지 체결을 보류합니다.",
          checkedAt: now.getTime(),
        },
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("아이디", { exact: true }).fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("tab", { name: "주문", exact: true }).click();
  await expect(page.getByLabel("거래 상태", { exact: true })).toContainText(
    "VI 발동",
  );
  await expect(
    page.getByRole("button", { name: "삼성전자 매수", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".execution-state")
    .screenshot({ path: "artifacts/execution-paused-mobile.png" });
});
