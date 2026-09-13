import { openDetails } from "./uiControls";
import { test, expect, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("아이디", { exact: true }).fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "차트", exact: true }),
  ).toBeVisible();
}

test("모바일 종목 검색 → 호가 선택 → 주문 및 기록 상세", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const registration = await request.post("/api/register", {
    headers: { "X-Study-Client": "web" },
    data: {
      username: "mobile_" + crypto.randomUUID().slice(0, 8),
      name: "모바일 테스트 멤버",
      password: "Study!2026",
      invite: "STUDY2026",
    },
  });
  expect(registration.ok()).toBeTruthy();
  const { user: member } = await registration.json();
  const grant = await page.request.post("/api/admin/grants", {
    headers: { "X-Study-Client": "web" },
    data: {
      userId: member.id,
      amount: 10000000,
      note: "모바일 UI 검증",
      requestId: crypto.randomUUID(),
    },
  });
  expect(grant.ok()).toBeTruthy();
  await page.context().addCookies((await request.storageState()).cookies);
  const buy = await page.request.post("/api/orders", {
    headers: { "X-Study-Client": "web" },
    data: {
      symbol: "005930",
      side: "buy",
      type: "market",
      quantity: 1,
      requestId: crypto.randomUUID(),
    },
  });
  expect(buy.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "종목 변경", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "종목 탐색" });
  await expect(picker).toBeVisible();
  await expect(picker.getByLabel("종목 검색")).toBeFocused();
  await picker.getByLabel("종목 검색").fill("없는종목검색");
  await expect(picker.getByText("검색 결과가 없습니다.")).toBeVisible();
  await picker.getByLabel("종목 검색").fill("000660");
  await picker.locator(".stock-select").click();
  await expect(picker).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "종목 변경", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".mobile-instrument")).toContainText("SK하이닉스");
  await expect(
    page.getByRole("tabpanel", { name: "차트", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "호가", exact: true }).click();
  const book = page.getByRole("tabpanel", { name: "호가", exact: true });
  const price = await book.locator(".book-row b").first().innerText();
  await book.locator(".book-row").first().click();
  await expect(
    page.getByRole("tab", { name: "주문", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("주문 유형")).toHaveValue("limit");
  await expect(page.getByLabel("주문 가격", { exact: true })).toHaveValue(
    price.replaceAll(",", ""),
  );
  await page.getByLabel("주문 가격", { exact: true }).fill("1");
  await page.getByLabel("주문 수량", { exact: true }).fill("3");
  const note = "모바일 탭 전환 후에도 유지되는 매매 이유";
  await openDetails(page, ".order-notes");
  await page.getByLabel("매매 이유").fill(note);
  await page.getByRole("tab", { name: "차트", exact: true }).click();
  await page.getByRole("tab", { name: "주문", exact: true }).click();
  await expect(page.getByLabel("주문 수량", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("매매 이유")).toHaveValue(note);
  await page
    .getByRole("button", { name: "SK하이닉스 매수", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("접수되었습니다");
  await page.getByRole("button", { name: /주문 내역/ }).click();
  const record = page
    .getByRole("table", { name: "주문 내역", exact: true })
    .locator("tbody tr")
    .filter({ hasText: note });
  await expect(record.locator(".note-cell")).not.toBeVisible();
  await expect(
    record.getByRole("button", { name: "정정", exact: true }),
  ).toBeVisible();
  await record.getByRole("button", { name: /주문 .* 상세/ }).click();
  await expect(record.locator(".note-cell")).toContainText(note);
  await expect(record.locator(".note-cell")).toBeVisible();
  await record.getByRole("button", { name: /주문 .* 상세/ }).click();
  await record.getByRole("button", { name: "정정", exact: true }).click();
  await expect(page.getByLabel("정정 가격", { exact: true })).toBeFocused();
  await page.getByLabel("정정 가격", { exact: true }).fill("2");
  await page.getByRole("button", { name: "정정 접수", exact: true }).click();
  await expect(page.locator(".amend-form")).toHaveCount(0);
  await page
    .getByRole("table", { name: "주문 내역", exact: true })
    .getByRole("button", { name: "취소", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "내 투자 계좌", exact: true }).click();
  const holding = page
    .getByRole("table", { name: "보유 종목", exact: true })
    .locator("tbody tr")
    .first();
  await expect(holding.locator('[data-label="평가금액"]')).toBeVisible();
  await expect(holding.locator('[data-label="평균 매수가"]')).not.toBeVisible();
  await holding.getByRole("button", { name: /보유 상세/ }).click();
  await expect(holding.locator('[data-label="평균 매수가"]')).toBeVisible();
  await holding.getByRole("button", { name: /보유 상세/ }).click();
  await expect(holding.locator('[data-label="평균 매수가"]')).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("모바일 검색 닫기·화면 크기 전환·탭 키보드 이동", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "종목 변경", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
  for (const width of [320, 360, 600]) {
    await page.setViewportSize({ width, height: 740 });
    await page
      .getByRole("button", { name: "내 투자 계좌", exact: true })
      .click();
    await page.getByRole("button", { name: "트레이딩", exact: true }).click();
    await page.getByRole("tab", { name: "차트", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: "호가", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("tabpanel", { name: "호가", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "종목 변경", exact: true }).click();
  await page.setViewportSize({ width: 1512, height: 1100 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("종목 검색")).toBeVisible();
  await expect(page.locator(".chart-panel")).toBeVisible();
  await expect(page.locator(".order-panel")).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("tab", { name: "호가", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "종목 변경", exact: true }).click();
  await page
    .getByRole("button", { name: "종목 탐색 닫기", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
