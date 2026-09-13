import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, path = "/?page=trade") {
  expect(
    (
      await page.request.post("/api/login", {
        headers: { "X-Study-Client": "web" },
        data: { username: "admin", password: "Study!2026" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(path);
}
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on("pageerror", (e) => list.push(e.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));
test("모바일 첫 화면 차트·접힌 도구·고정 주문 버튼과 낮은 화면", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.locator(".trade-account-summary > button")).toHaveCount(3);
  await expect(page.locator(".chart-wrap svg")).toBeVisible();
  expect((await page.locator(".chart-wrap svg").boundingBox())!.y).toBeLessThan(
    560,
  );
  await page
    .getByRole("button", { name: "자세히 보기 · 그리기", exact: true })
    .click();
  await expect(page.getByTestId("drawing-canvas")).toBeVisible();
  expect(
    (await page.getByTestId("drawing-canvas").boundingBox())!.y,
  ).toBeLessThan(320);
  await expect(page.locator(".chart-drawing-settings")).not.toHaveAttribute(
    "open",
    "",
  );
  await page
    .getByRole("navigation", { name: "차트 도구" })
    .getByRole("button", { name: "보조지표", exact: true })
    .click();
  await expect(page.locator(".indicator-picker")).toHaveAttribute("open", "");
  await page
    .getByRole("button", { name: "차트 도구 닫기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "차트 자세히 보기 닫기", exact: true })
    .click();
  await page.getByRole("tab", { name: "주문", exact: true }).click();
  await expect(page.locator(".order-notes")).not.toHaveAttribute("open", "");
  for (const size of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 390, height: 450 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.locator(".submit-order")).toBeInViewport({ ratio: 1 });
    const submit = (await page.locator(".order-submit-bar").boundingBox())!,
      nav = (await page.locator(".sidebar").boundingBox())!;
    expect(submit.y).toBeGreaterThanOrEqual(0);
    expect(submit.y + submit.height).toBeLessThanOrEqual(nav.y + 1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: "artifacts/workspace-order-small.png" });
});
test("종목·봉·목록 위치와 분석 조건을 뒤로가기·새로고침으로 복원", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, "/?page=trade&symbol=000660&period=W&stockPage=1");
  await expect(page.locator(".stock-row")).toHaveCount(10);
  await expect(page.locator(".stock-pagination").first()).toContainText("2 /");
  await expect(page.locator(".chart-wrap svg")).toBeVisible();
  await page.locator(".stock-list").evaluate((el) => (el.scrollTop = 200));
  await page.evaluate(() => scrollTo(0, 250));
  await expect
    .poll(() => page.evaluate(() => history.state?.workspace?.position.y))
    .toBe(250);
  await page.getByRole("button", { name: "시장 분석", exact: true }).click();
  await expect(page).toHaveURL(/page=analysis/);
  await page.getByRole("button", { name: "거래대금", exact: true }).click();
  await page.getByLabel("분석 종목 검색").fill("삼성");
  await expect(page).toHaveURL(/metric=turnover/);
  await page.goBack();
  await expect(page).toHaveURL(/page=trade/);
  await expect(page.locator(".instrument h2")).toContainText("SK하이닉스");
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(250);
  await expect
    .poll(() =>
      page.locator(".stock-list").evaluate((el) => Math.round(el.scrollTop)),
    )
    .toBe(200);
  await page.goForward();
  await expect(page.getByLabel("분석 종목 검색")).toHaveValue("삼성");
  await page.reload();
  await expect(page.getByLabel("분석 종목 검색")).toHaveValue("삼성");
  await expect(
    page.getByRole("button", { name: "거래대금", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
test("계좌 탭 주소·키보드·새로고침과 모바일 시장 목록 상세", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "/?page=account&account=pending");
  await expect(
    page.getByRole("tab", { name: "미체결", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "체결 내역", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "주문 · 체결 내역", exact: true }),
  ).toBeInViewport();
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "체결 내역", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "체결 내역", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("region", { name: "투자 일지", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "시장 분석", exact: true }).click();
  const row = page.locator(".analysis-result").first();
  await expect(row).toBeVisible();
  expect((await row.boundingBox())!.height).toBeLessThan(230);
  await expect(row.locator(".analysis-detail").first()).not.toBeVisible();
  await row.getByRole("button", { name: /상세$/ }).click();
  await expect(row.locator(".analysis-detail").first()).toBeVisible();
  await page.screenshot({ path: "artifacts/workspace-market-mobile.png" });
});
test("모바일 종목 필터와 뒤로가기의 대화상자 닫기", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "/?page=analysis");
  await page.getByRole("button", { name: "트레이딩", exact: true }).click();
  await page.getByRole("button", { name: "종목 변경", exact: true }).click();
  await expect(page.locator(".stock-filters")).not.toHaveAttribute("open", "");
  await page.locator(".stock-filters > summary").click();
  await page
    .getByRole("group", { name: "상품 유형 선택" })
    .getByRole("button", { name: "주식", exact: true })
    .click();
  await page.locator(".stock-filters > summary").click();
  await expect(page.locator(".stock-filters > summary")).toContainText("주식");
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/page=trade/);
  await page.goBack();
  await expect(page).toHaveURL(/page=analysis/);
});
