import { test, expect } from "@playwright/test";
test("시장 브리핑 필터·부분 장애·날짜 격리와 모바일 발행일 차트 이동", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/market-analysis?*", async (route) => {
    const liveUrl = new URL(route.request().url());
    liveUrl.searchParams.delete("date");
    const response = await route.fetch({ url: liveUrl.toString() });
    const data = await response.json();
    const date =
      new URL(route.request().url()).searchParams.get("date") || "2026-09-09";
    const rows = [
      ["005930", "삼성전자", 5, 300],
      ["000660", "SK하이닉스", 10, 200],
      ["035420", "NAVER", -2, 100],
    ].map(([symbol, name, changeRate, turnover]) => ({
      symbol,
      name,
      changeRate,
      turnover,
      market: "KOSPI",
      price: 100,
      volume: 100,
      volumeRatio: 1,
      upperPrice: 130,
      lowerPrice: 70,
    }));
    await route.fulfill({
      json: {
        ...data,
        dates: ["2026-09-09", "2026-09-08"],
        report: {
          ...data.report,
          date,
          sections: Object.fromEntries(
            Object.keys(data.report.sections).map((key) => [
              key,
              { rows, error: null, collectedAt: "2026-09-09T02:00:00Z" },
            ]),
          ),
          lowerHits: [
            {
              ...rows[2],
              active: true,
              firstSeen: "2026-09-09T02:00:00Z",
              lastSeen: "2026-09-09T02:00:00Z",
            },
          ],
          upperHits: [
            {
              ...rows[1],
              active: true,
              firstSeen: "2026-09-09T02:00:00Z",
              lastSeen: "2026-09-09T02:00:00Z",
            },
          ],
        },
      },
    });
  });
  await page.route("**/api/stock-news?*", (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol");
    if (symbol === "035420")
      return route.fulfill({ status: 503, json: { error: "뉴스 공급 지연" } });
    const name = symbol === "005930" ? "삼성전자" : "SK하이닉스";
    return route.fulfill({
      json: {
        symbol,
        name,
        updatedAt: "2026-09-09T02:00:00Z",
        stale: false,
        unavailableFeeds: [],
        articles: [
          {
            title: name + (symbol === "005930" ? " 실적 개선" : " 신제품 출시"),
            source: "매일경제",
            publishedAt: "2026-09-09T02:00:00Z",
            url: "https://www.mk.co.kr/news/stock/" + symbol,
          },
          {
            title: name + " 어제 뉴스",
            source: "한국경제",
            publishedAt: "2026-09-08T02:00:00Z",
            url: "https://www.hankyung.com/article/" + symbol,
          },
        ],
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("아이디", { exact: true }).fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("button", { name: "시장 분석", exact: true }).click();
  await page.getByRole("tab", { name: "뉴스", exact: true }).click();
  const briefing = page.getByRole("region", { name: "시장 이슈 브리핑" });
  await expect(briefing.locator(".market-news-stock")).toHaveCount(2);
  await expect(briefing).toContainText("뉴스 공급 지연");
  await expect(briefing).toContainText("원문 2건");
  await expect(briefing).not.toContainText("어제 뉴스");
  await expect(briefing.locator(".market-news-stock")).toHaveCount(2);
  await page.getByLabel("브리핑 뉴스 유형").selectOption("earnings");
  await expect(briefing.locator(".market-news-stock")).toHaveCount(1);
  await expect(briefing).toContainText("삼성전자 실적 개선");
  await page.getByLabel("브리핑 뉴스 유형").selectOption("all");
  await page.getByLabel("브리핑 비교 대상").selectOption("lower");
  await expect(briefing.locator(".market-news-stock")).toHaveCount(0);
  await expect(briefing).toContainText("NAVER");
  await expect(briefing).toContainText("뉴스 공급 지연");
  await expect(briefing).not.toContainText("삼성전자");
  await page.getByLabel("브리핑 비교 대상").selectOption("upper");
  await expect(briefing.locator(".market-news-stock")).toHaveCount(1);
  await expect(briefing).toContainText("SK하이닉스 신제품 출시");
  await page.getByLabel("분석 날짜").selectOption("2026-09-08");
  await expect(briefing).toContainText("SK하이닉스 어제 뉴스");
  await expect(briefing).not.toContainText("신제품 출시");
  await page.getByLabel("분석 날짜").selectOption("");
  await expect(briefing).toContainText("SK하이닉스 신제품 출시");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await briefing.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({ path: "artifacts/market-news-mobile.png" });
  await briefing
    .getByRole("button", { name: "발행일 차트 · SK하이닉스", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "차트", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("region", { name: "선택 뉴스의 일봉" }),
  ).toContainText("SK하이닉스 신제품 출시");
  await expect(page.locator(".mobile-instrument")).toContainText("SK하이닉스");
  expect(errors).toEqual([]);
});
