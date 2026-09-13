import { openDetails } from "./uiControls";
import { test, expect, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
const catalog = {
  updatedAt: "2026-09-09T00:00:00.000Z",
  themes: [
    { code: "004", name: "반도체/반도체장비", symbols: ["005930", "000660"] },
    { code: "231", name: "HBM", symbols: ["005930", "000660"] },
    { code: "260", name: "2차전지", symbols: ["051910"] },
    { code: "999", name: "거래 목록 외 테마", symbols: ["999999"] },
  ],
};
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("아이디", { exact: true }).fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "차트", exact: true }),
  ).toBeVisible();
}

test("테마명 검색·시장·관심 종목 조합과 관련 테마 이동", async ({ page }) => {
  await page.route("**/api/stock-themes", (route) =>
    route.fulfill({ json: catalog }),
  );
  await login(page);
  await page.getByRole("button", { name: "종목 변경", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "종목 탐색" });
  await openDetails(page, ".stock-filters");
  const select = picker.getByLabel("테마 분류");
  await expect(select).toBeEnabled();
  await expect(select.locator('option[value="999"]')).toHaveCount(0);
  await picker.getByLabel("종목 검색").fill("반도체 삼성");
  await expect(picker.locator(".stock-select")).toHaveCount(1);
  await expect(picker.locator(".stock-select")).toContainText("삼성전자");
  await picker.getByLabel("종목 검색").fill("");
  await select.selectOption("004");
  await expect(picker.locator(".stock-select")).toHaveCount(2);
  await picker.getByRole("button", { name: "코스닥", exact: true }).click();
  await expect(picker.locator(".stock-select")).toHaveCount(0);
  await expect(select).toHaveValue("004");
  await picker.getByRole("button", { name: "코스피", exact: true }).click();
  await picker
    .getByRole("button", { name: "삼성전자 관심 종목", exact: true })
    .click();
  await picker.getByRole("button", { name: /관심 종목 \d/ }).click();
  await expect(picker.locator(".stock-select")).toHaveCount(1);
  await expect(select.locator('option[value="004"]')).toContainText("(1)");
  await picker
    .getByRole("button", { name: "필터 초기화", exact: true })
    .click();
  await select.selectOption("UNCLASSIFIED");
  await expect(
    picker.locator(".stock-select").filter({ hasText: "삼성전자" }),
  ).toHaveCount(0);
  await expect(
    picker.locator(".stock-select").filter({ hasText: "NAVER" }),
  ).toHaveCount(1);
  await picker
    .getByRole("button", { name: "필터 초기화", exact: true })
    .click();
  await picker.getByLabel("종목 검색").fill("005930");
  await picker.locator(".stock-select").click();
  await page.locator(".selected-stock-themes summary").click();
  await page
    .locator(".selected-stock-themes")
    .getByRole("button", { name: "HBM", exact: true })
    .click();
  await expect(picker).toBeVisible();
  await expect(select).toHaveValue("231");
  await expect(picker.locator(".stock-select")).toHaveCount(2);
  await page.setViewportSize({ width: 1512, height: 1100 });
  await expect(page.getByLabel("테마 분류")).toHaveValue("231");
  await expect(page.locator(".stock-select")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("테마 조회 실패 시 기본 검색 유지 및 재시도", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/stock-themes", (route) => {
    requests++;
    return requests === 1
      ? route.fulfill({ status: 503, json: { error: "분류 조회 실패" } })
      : route.fulfill({ json: catalog });
  });
  await login(page);
  await page.getByRole("button", { name: "종목 변경", exact: true }).click();
  await openDetails(page, ".stock-filters");
  await expect(page.getByLabel("테마 분류")).toBeDisabled();
  await page.getByLabel("종목 검색").fill("005930");
  await expect(page.getByRole("dialog").locator(".stock-select")).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.getByLabel("테마 분류")).toBeEnabled();
  await expect(page.locator(".theme-error")).toHaveCount(0);
  await page.getByLabel("종목 검색").fill("HBM");
  // Names containing HBM can also match; verify the two theme fixtures explicitly.
  for (const symbol of ["005930", "000660"]) {
    await expect(
      page
        .getByRole("dialog")
        .locator(".stock-select")
        .filter({ hasText: symbol }),
    ).toContainText("HBM");
  }
});
