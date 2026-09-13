import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, path = "/?page=analysis") {
  const servers = test.info().config.webServer;
  const server = Array.isArray(servers) ? servers[0] : servers;
  expect(server?.env?.MARKET_PROVIDER).toBe("demo");
  const response = await page.request.post("/api/login", {
    headers: { "X-Study-Client": "web" },
    data: {
      username: server?.env?.ADMIN_USERNAME,
      password: server?.env?.ADMIN_PASSWORD,
    },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto(path);
}

test("첫 화면 순위와 모든 지표의 핵심 값이 모바일에서 바로 보인다", async ({
  page,
}) => {
  let newsRequests = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/api/stock-news?")) newsRequests++;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const first = page.locator(".analysis-result").first();
  await expect(first).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "종목", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  for (const width of [320, 390, 600, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/market-tabs-${width}.png` });
    expect((await first.boundingBox())!.y).toBeLessThan(760);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [metric, label] of [
    ["상한가 포착", "포착 등락률"],
    ["하한가 포착", "포착 등락률"],
    ["상승률", "등락률"],
    ["하락률", "등락률"],
    ["거래량", "거래량"],
    ["거래대금", "거래대금"],
    ["거래량 증가", "전일 거래량 대비"],
  ]) {
    await page.getByRole("button", { name: metric, exact: true }).click();
    await expect(first.locator(".analysis-primary")).toBeVisible();
    await expect(first.locator(".analysis-primary")).toHaveAttribute(
      "data-label",
      label,
    );
    expect((await first.boundingBox())!.height).toBeLessThan(210);
    await first.getByRole("button", { name: /상세$/ }).click();
    await expect(first.locator(".analysis-primary")).toBeVisible();
    await first.getByRole("button", { name: /상세$/ }).click();
  }
  await expect(first.locator(".analysis-primary")).toContainText("배");
  await expect(page.locator(".analysis-metric-note")).toContainText(
    "같은 시간대 비교가 아닙니다",
  );
  expect(newsRequests).toBe(0);
  expect(errors).toEqual([]);
});

test("테마 목록은 중첩 스크롤 없이 펼치고 조건 검색으로 이어지며 탭을 복원한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "거래량 증가", exact: true }).click();
  await page.getByLabel("분석 종목 검색").fill("삼성");
  await page.getByRole("tab", { name: "테마", exact: true }).click();
  await expect(page.locator(".theme-strength-card").first()).toBeVisible();
  expect(
    await page.locator(".theme-strength-card").count(),
  ).toBeLessThanOrEqual(5);
  expect(
    await page
      .locator(".theme-strength-grid")
      .evaluate((el) => el.scrollHeight - el.clientHeight),
  ).toBeLessThanOrEqual(1);
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "테마", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(
    page.getByRole("tab", { name: "종목", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("분석 종목 검색")).toHaveValue("삼성");
  await expect(
    page.getByRole("button", { name: "거래량 증가", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.goForward();
  const theme = page.locator(".theme-strength-card").first();
  await theme.locator(":scope > summary").click();
  await theme
    .getByRole("button", { name: "테마 종목 모아보기", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "종목", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#analysis-screener")).toHaveAttribute("open", "");
  await expect(page.getByLabel("테마 조건")).not.toHaveValue("");
  await expect(page.getByLabel("테마 조건")).toBeInViewport();
  await page.getByRole("tab", { name: "종목", exact: true }).focus();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("tab", { name: "요약", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#analysis-history")).toBeVisible();
  await expect(page.locator(".analysis-ranking")).toHaveCount(0);
});

test("상한가 현재 확인·장중 기록·지연 상태가 접힌 목록에서도 구분된다", async ({
  page,
}) => {
  let stale = false;
  await page.route("**/api/market-analysis?*", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    const source = data.report.upperHits[0];
    data.report.upperHits = [true, false, null].map((active, i) => ({
      ...source,
      symbol: ["005930", "000660", "035420"][i],
      name: ["삼성전자", "SK하이닉스", "NAVER"][i],
      active,
    }));
    data.stale = stale;
    await route.fulfill({ json: data });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.locator(".limit-badge")).toHaveText([
    "최근 수집 때 도달",
    "장중 포착",
    "조회 지연",
  ]);
  for (const badge of await page.locator(".limit-badge").all())
    await expect(badge).toBeVisible();
  await page
    .locator(".analysis-result")
    .first()
    .getByRole("button", { name: /상세$/ })
    .click();
  await expect(page.locator(".limit-times").first()).toBeVisible();
  stale = true;
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.locator(".limit-badge")).toHaveText([
    "조회 지연",
    "조회 지연",
    "조회 지연",
  ]);
});

test("뉴스는 탭 진입 시 조회하고 같은 원문을 제외한 이슈를 3개씩 표시한다", async ({
  page,
}) => {
  const day = new Date().toISOString().slice(0, 10);
  const titles = [
    "반도체 실적 개선",
    "미국 금리 동결",
    "신규 공장 가동",
    "배당 지급 결정",
    "대표이사 신규 선임",
    "해외 공급 계약 체결",
  ];
  await page.route("**/api/stock-news?*", (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol");
    return route.fulfill({
      json: {
        symbol,
        name: symbol,
        updatedAt: day + "T02:00:00Z",
        stale: false,
        unavailableFeeds: [],
        articles: titles.map((title, i) => ({
          title,
          source: "검증 뉴스",
          publishedAt: day + `T0${i}:00:00Z`,
          url: `https://example.test/news/${i}`,
        })),
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("tab", { name: "뉴스", exact: true }).click();
  await expect(page.locator(".market-news-summary")).not.toContainText(
    "수집 중",
  );
  await expect(page.locator(".market-news-stock")).toHaveCount(3);
  await page.getByRole("button", { name: /이슈 3개 더 보기/ }).click();
  await expect(page.locator(".market-news-stock")).toHaveCount(6);
  await expect(
    page.getByRole("button", { name: /이슈 3개 더 보기/ }),
  ).toHaveCount(0);
  await page.getByLabel("브리핑 뉴스 유형").selectOption("earnings");
  await expect(page.locator(".market-news-stock")).toHaveCount(1);
  await expect(page.locator(".market-news-stock")).toContainText(
    "반도체 실적 개선",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
});
