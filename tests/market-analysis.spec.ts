import { test, expect } from "@playwright/test";

test("시장 분석 메뉴·지표·날짜·시장 선택과 종목 트레이딩 이동", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("아이디", { exact: true }).fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("button", { name: "시장 분석", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "시장 분석", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".summary-grid")).toHaveCount(0);
  await expect(
    page.getByRole("table", { name: "상한가 포착 목록" }),
  ).toBeVisible();
  await expect(page.locator(".analysis-footnote")).toContainText(
    "실제 시장 움직임이 아닙니다",
  );
  await expect(
    page.getByRole("columnheader", { name: "최근 포착가", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/market-analysis-desktop.png",
    fullPage: true,
  });
  const nav = await page.locator(".sidebar nav button").allTextContents();
  expect(nav[0]).toContain("트레이딩");
  expect(nav[1]).toContain("시장 분석");
  await page.getByRole("button", { name: "거래대금", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "거래대금 목록" }),
  ).toBeVisible();
  await page.getByLabel("분석 시장").selectOption("KOSPI");
  await expect(page.locator(".index-card h2")).toHaveText("KOSPI");
  await expect(page.getByLabel("분석 날짜").locator("option")).not.toHaveCount(
    1,
  );
  const savedDate = await page
    .getByLabel("분석 날짜")
    .locator("option")
    .nth(1)
    .getAttribute("value");
  await page.getByLabel("분석 날짜").selectOption(savedDate!);
  await expect(page.locator(".analysis-controls p")).toContainText(savedDate!);
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "상승률", exact: true }).click();
    await expect(
      page.getByRole("table", { name: "상승률 목록" }),
    ).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/market-analysis-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("table", { name: "상승률 목록" })
    .locator(".table-link")
    .first()
    .click();
  await expect(
    page.getByRole("tab", { name: "차트", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("시장 분석 조회 장애와 과거 없는 기록 안내", async ({ page }) => {
  await page.route("**/api/market-analysis?*", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "이 날짜에는 저장된 분석이 없습니다." },
    }),
  );
  await page.goto("/");
  await page.getByLabel("아이디", { exact: true }).fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("button", { name: "시장 분석", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("저장된 분석이 없습니다");
  await expect(
    page.getByRole("button", { name: "다시 시도", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".analysis-table")).toHaveCount(0);
});

test("시장 요약·테마 비교·조건 검색·장중 기록과 자동 갱신", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("아이디", { exact: true }).fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("button", { name: "시장 분석", exact: true }).click();
  await expect(page.getByRole("region", { name: "시장 요약" })).toContainText(
    "상승",
  );
  await page.getByRole("tab", { name: "테마", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "테마 비교", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "종목", exact: true }).click();
  await page.locator("#analysis-screener > summary").click();
  await page
    .getByRole("button", { name: "상승 + 거래량 증가", exact: true })
    .click();
  await expect(page.getByLabel("최소 등락률 (%)", { exact: true })).toHaveValue(
    "3",
  );
  await expect(
    page.getByLabel("최소 거래대금 (억)", { exact: true }),
  ).toHaveValue("100");
  await page
    .getByLabel("최소 거래대금 (억)", { exact: true })
    .fill("999999999999");
  await expect(
    page.getByText(
      "조건에 맞는 종목이 없습니다. 기준을 낮추거나 초기화해 주세요.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "조건 초기화", exact: true }).click();
  await expect(page.locator(".screener-results article").first()).toBeVisible();
  await page.getByRole("tab", { name: "요약", exact: true }).click();
  await page.locator("summary").filter({ hasText: "장중 흐름 기록" }).click();
  await expect(page.getByLabel("기록 지수")).toBeVisible();
  await page.route("**/api/market-analysis?*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.locator(".analysis-brief")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "새로고침", exact: true }),
  ).toBeEnabled();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".analysis-brief").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/analysis-v2-mobile.png" });
});

test("장중 기록의 시점 선택과 누락 지수 표시", async ({ page }) => {
  await page.route("**/api/market-analysis?*", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const r = payload.report;
    r.history = [
      {
        collectedAt: r.date + "T01:00:00Z",
        indices: r.indices,
        upperCount: 1,
        lowerCount: 0,
      },
      {
        collectedAt: r.date + "T01:05:00Z",
        indices: [],
        upperCount: 1,
        lowerCount: 0,
      },
      {
        collectedAt: r.date + "T01:10:00Z",
        indices: r.indices,
        upperCount: 1,
        lowerCount: 0,
      },
    ];
    await route.fulfill({ json: payload });
  });
  await page.goto("/");
  await page.getByLabel("아이디", { exact: true }).fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("button", { name: "시장 분석", exact: true }).click();
  await page.getByRole("tab", { name: "요약", exact: true }).click();
  await page.locator("summary").filter({ hasText: "장중 흐름 기록" }).click();
  await expect(
    page.getByRole("img", { name: "KOSPI 수집 시점별 전일 대비 등락률" }),
  ).toBeVisible();
  const slider = page.getByRole("slider", { name: "수집 시점 선택" });
  await slider.fill("1");
  await expect(page.getByText("10:05 · 지수 조회 누락")).toBeVisible();
  await slider.fill("0");
  await expect(page.getByText("10:00 · 2,654.32 (+1.23%)")).toBeVisible();
  await page.getByLabel("기록 지수").selectOption("KOSDAQ");
  await expect(
    page.getByRole("img", { name: "KOSDAQ 수집 시점별 전일 대비 등락률" }),
  ).toBeVisible();
});
