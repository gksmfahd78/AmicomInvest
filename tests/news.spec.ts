import { test, expect } from "@playwright/test";
async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("아이디", { exact: true }).fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}
const payload = {
  symbol: "005930",
  name: "삼성전자",
  articles: [
    {
      title: "삼성전자, 실적 개선 전망",
      url: "https://www.mk.co.kr/news/stock/123",
      publishedAt: "2026-09-09T02:00:00Z",
      source: "매일경제",
    },
  ],
  updatedAt: "2026-09-09T03:00:00Z",
  stale: false,
  unavailableFeeds: [],
};
test("종목 뉴스 PC·모바일 탭과 원문 링크", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/stock-news?*", (route) =>
    route.fulfill({ json: payload }),
  );
  await login(page);
  await expect(
    page.getByRole("heading", { name: "삼성전자 관련 뉴스" }),
  ).toBeVisible();
  const article = page.getByRole("link", { name: "삼성전자, 실적 개선 전망" });
  await expect(article).toHaveAttribute("target", "_blank");
  await expect(article).toHaveAttribute("rel", "noopener noreferrer");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("tab", { name: "뉴스", exact: true }).click();
    await expect(page.getByRole("tabpanel", { name: "뉴스" })).toBeVisible();
    await expect(page.locator("#trade-chart-panel")).toBeHidden();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#trade-news-panel").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/stock-news-mobile.png" });
  expect(errors).toEqual([]);
});
test("뉴스 없음·공급 장애·종목 변경 시 이전 뉴스 제거", async ({ page }) => {
  let fail = false;
  await page.route("**/api/stock-news?*", (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol");
    return fail
      ? route.fulfill({ status: 503, json: { error: "뉴스 공급 지연" } })
      : route.fulfill({
          json: {
            ...payload,
            symbol,
            articles: symbol === "005930" ? payload.articles : [],
          },
        });
  });
  await login(page);
  await expect(
    page.getByRole("heading", { name: "삼성전자 관련 뉴스" }),
  ).toBeVisible();
  await page
    .locator(".stock-select")
    .filter({ hasText: "SK하이닉스" })
    .first()
    .click();
  await expect(page.locator(".stock-news-panel")).toContainText(
    "관련 기사를 찾지 못했습니다",
  );
  await expect(page.locator(".stock-news-panel")).not.toContainText(
    "삼성전자, 실적 개선 전망",
  );
  fail = true;
  await page.getByRole("button", { name: "관련 뉴스 새로고침" }).click();
  await expect(
    page.locator(".stock-news-panel").getByRole("alert"),
  ).toContainText("뉴스 공급 지연");
});

test("여러 언론사 표시·필터·모바일과 일부 수집 지연", async ({ page }) => {
  const multi = {
    ...payload,
    stale: true,
    unavailableFeeds: ["연합뉴스 · 경제"],
    articles: [
      ...payload.articles,
      {
        title: "한국경제 삼성전자 실적",
        source: "한국경제",
        url: "https://www.hankyung.com/article/202609093724i",
        publishedAt: payload.articles[0].publishedAt,
      },
      {
        title: "비즈니스포스트 삼성전자 실적",
        source: "비즈니스포스트",
        url: "https://www.businesspost.co.kr/BP?command=article_view&num=446766",
        publishedAt: payload.articles[0].publishedAt,
      },
      ...[
        ["파이낸셜뉴스", "https://www.fnnews.com/news/202609081338589294"],
        ["전자신문", "https://www.etnews.com/20260909000159"],
        ["뉴시스", "https://www.newsis.com/view/NISX20260909_0003782405"],
      ].map(([source, url]) => ({
        title: source + " 삼성전자 실적",
        source,
        url,
        publishedAt: payload.articles[0].publishedAt,
      })),
    ],
  };
  await page.route("**/api/stock-news?*", (route) =>
    route.fulfill({ json: multi }),
  );
  await login(page);
  await expect(page.locator(".stock-news-list a")).toHaveCount(6);
  const filters = page.getByRole("group", { name: "뉴스 언론사 선택" });
  await filters
    .getByRole("button", { name: "한국경제 1", exact: true })
    .click();
  await expect(page.locator(".stock-news-list a")).toHaveCount(1);
  await expect(page.locator(".stock-news-list")).toContainText(
    "한국경제 삼성전자 실적",
  );
  await filters
    .getByRole("button", { name: "연합뉴스 0", exact: true })
    .click();
  await expect(page.locator(".stock-news-panel")).toContainText(
    "연합뉴스의 최근 뉴스 제목에서",
  );
  await expect(
    page.locator(".stock-news-panel").getByRole("status"),
  ).toContainText("연합뉴스 · 경제");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("tab", { name: "뉴스", exact: true }).click();
  await page
    .getByLabel("뉴스 언론사", { exact: true })
    .selectOption("비즈니스포스트");
  await expect(page.locator(".stock-news-list a")).toHaveAttribute(
    "href",
    multi.articles[2].url,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const source of ["파이낸셜뉴스", "전자신문", "뉴시스"]) {
    await page.getByLabel("뉴스 언론사", { exact: true }).selectOption(source);
    await expect(page.locator(".stock-news-list a")).toHaveCount(1);
    await expect(page.locator(".stock-news-list")).toContainText(
      source + " 삼성전자 실적",
    );
  }
  await page.getByLabel("뉴스 언론사", { exact: true }).selectOption("전체");
  await page.locator("#trade-news-panel").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/seven-news-mobile.png" });
});

test("이슈 묶음·유형 필터·모바일 뉴스와 일봉 왕복", async ({ page }) => {
  const articles = [
    {
      ...payload.articles[0],
      title: "삼성전자 3분기 영업이익 10조 기록",
      publishedAt: "2026-09-09T07:00:00Z",
    },
    {
      ...payload.articles[0],
      title: "[속보] 삼성전자, 3분기 영업이익 10조원 기록",
      source: "한국경제",
      url: "https://www.hankyung.com/article/202609090001",
      publishedAt: "2026-09-09T02:00:00Z",
    },
    {
      ...payload.articles[0],
      title: "삼성전자 신제품 출시",
      url: "https://www.mk.co.kr/news/stock/456",
      publishedAt: "2026-09-08T02:00:00Z",
    },
  ];
  await page.route("**/api/stock-news?*", (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol");
    return route.fulfill({
      json: {
        ...payload,
        symbol,
        articles: symbol === "005930" ? articles : [],
      },
    });
  });
  await page.route("**/api/stock/005930?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      json: {
        ...data,
        candles: [
          {
            date: "2026-09-08",
            open: 90,
            high: 110,
            low: 80,
            close: 100,
            volume: 100,
          },
          {
            date: "2026-09-09",
            open: 105,
            high: 115,
            low: 95,
            close: 110,
            volume: 150,
          },
        ],
      },
    });
  });
  await login(page);
  await expect(page.locator(".stock-news-list > li")).toHaveCount(2);
  await page.getByText("유사 기사 2건 · 2개 언론사", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: articles[1].title }),
  ).toBeVisible();
  await page.getByRole("button", { name: "최신순", exact: true }).click();
  await expect(page.locator(".stock-news-list > li")).toHaveCount(3);
  await page.getByRole("button", { name: "이슈별", exact: true }).click();
  await page.getByLabel("뉴스 유형", { exact: true }).selectOption("product");
  await expect(page.locator(".stock-news-list > li")).toHaveCount(1);
  await expect(page.locator(".stock-news-list")).toContainText("신제품 출시");
  await page.getByLabel("뉴스 유형", { exact: true }).selectOption("all");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("button", { name: "주봉", exact: true }).click();
  await page.getByRole("tab", { name: "뉴스", exact: true }).click();
  await page
    .getByRole("button", {
      name: "차트에서 보기: " + articles[0].title,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("tab", { name: "차트", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "일봉", exact: true }),
  ).toHaveClass("selected");
  const toolbar = await page.locator(".chart-toolbar").boundingBox();
  const header = await page.locator(".mobile-trade-header").boundingBox();
  expect(toolbar!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  const context = page.getByRole("region", { name: "선택 뉴스의 일봉" });
  await expect(context).toContainText("2026-09-09");
  await expect(context).toContainText("장 마감 후");
  await expect(context).toContainText("+10.00%");
  await expect(page.locator(".news-candle-highlight")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/news-chart-mobile.png" });
  await page
    .getByRole("button", { name: "2026-09-08 뉴스 1건", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "뉴스", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".news-date-filter")).toContainText("2026-09-08");
  await expect(page.locator(".stock-news-list > li")).toHaveCount(1);
  await expect(page.locator(".stock-news-list")).toContainText("신제품 출시");
  await page
    .getByRole("button", { name: "날짜 조건 해제", exact: true })
    .click();
  await expect(page.locator(".stock-news-list > li")).toHaveCount(2);
  await page.screenshot({ path: "artifacts/news-issues-mobile.png" });
  await page.setViewportSize({ width: 1512, height: 1100 });
  await page
    .locator(".stock-select")
    .filter({ hasText: "SK하이닉스" })
    .first()
    .click();
  await expect(page.locator(".news-candle-context")).toHaveCount(0);
  await expect(page.locator(".chart-news-dates")).toHaveCount(0);
});
