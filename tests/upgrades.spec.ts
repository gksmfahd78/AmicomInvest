import { openDetails } from "./uiControls";
import { test, expect } from "@playwright/test";
async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("아이디", { exact: true }).fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: /자세히 보기/ })).toBeVisible();
}
test("과거 조회·이평선·그림 다른 기기 저장·정정 화면", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.getByRole("button", { name: /자세히 보기/ }).click();
  await openDetails(page, ".chart-display-settings");
  await expect(page.getByText("계정에 저장됨", { exact: false })).toBeVisible();
  await expect(page.locator(".zoom-actions")).toContainText("100 / 200개 봉");
  await page.getByRole("button", { name: "과거 더 보기", exact: true }).click();
  await expect(page.locator(".zoom-actions")).toContainText("100 / 300개 봉");
  await openDetails(page, ".chart-drawing-settings");
  await page.getByRole("button", { name: "추세선", exact: true }).click();
  const canvas = page.getByTestId("drawing-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.up();
  await expect(page.locator("[data-drawing-id]")).toHaveCount(1);
  await expect(page.locator(".advanced-footer")).toContainText("계정에 저장됨");
  const second = await browser.newContext({
      baseURL: new URL(page.url()).origin,
    }),
    p2 = await second.newPage();
  await login(p2);
  await p2.getByRole("button", { name: /자세히 보기/ }).click();
  await expect(p2.locator("[data-drawing-id]")).toHaveCount(1);
  await page.screenshot({ path: "artifacts/chart-upgraded.png" });
  await openDetails(p2, ".chart-drawing-settings");
  await p2.getByRole("button", { name: "전체 지우기", exact: true }).click();
  await expect(p2.locator(".advanced-footer")).toContainText("계정에 저장됨");
  await second.close();
  await page.getByRole("button", { name: "차트 자세히 보기 닫기" }).click();
  const h = { "X-Study-Client": "web" };
  await page.request.post("/api/admin/grants", {
    headers: h,
    data: {
      userId: 1,
      amount: 100000,
      note: "upgrade test",
      requestId: crypto.randomUUID(),
    },
  });
  const r = await page.request.post("/api/orders", {
    headers: h,
    data: {
      symbol: "005930",
      side: "buy",
      type: "limit",
      quantity: 2,
      limitPrice: 1,
      requestId: crypto.randomUUID(),
    },
  });
  expect(r.ok()).toBeTruthy();
  await page.getByRole("button", { name: "내 투자 계좌", exact: true }).click();
  await page.getByRole("tab", { name: "미체결", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "정정", exact: true }).first(),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "정정", exact: true }).first().click();
  await page.getByLabel("정정 가격", { exact: true }).fill("2");
  await page.getByRole("button", { name: "정정 접수", exact: true }).click();
  await expect(page.locator(".amend-form")).toHaveCount(0);
  await page.getByRole("tab", { name: "체결 내역", exact: true }).click();
  await expect(page.getByText("정정으로 대체", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
