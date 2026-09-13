import { test, expect, type Page } from "@playwright/test";
const headers = { "X-Study-Client": "web" };
test.use({ hasTouch: true });
async function login(
  page: Page,
  path = "/?page=trade&tab=financials&symbol=005930",
) {
  const configured = test.info().config.webServer;
  const server = Array.isArray(configured) ? configured[0] : configured;
  expect(server?.env?.MARKET_PROVIDER).toBe("demo");
  const response = await page.request.post("/api/login", {
    headers,
    data: {
      username: server?.env?.ADMIN_USERNAME,
      password: server?.env?.ADMIN_PASSWORD,
    },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto(path);
}
const menu = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "종목 분석 메뉴" })
    .getByRole("button", { name, exact: true });
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  const panel = page.locator(".trade-financials-panel");
  expect(
    await panel.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
}
test("분석 API 인증·종목·회계 기준·조회 범위 검증", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/research/005930/flows")).status()).toBe(401);
  await login(page);
  for (const path of [
    "005930/unknown",
    "069500/flows",
    "005930/peers?symbols=069500",
    "005930/peers?symbols=000660,035420,035720",
    "005930/dart?year=2010",
    "005930/dart?basis=UNKNOWN",
    "999999/flows",
  ])
    expect((await page.request.get("/api/research/" + path)).ok()).toBeFalsy();
  for (const section of ["flows", "estimates", "dividends", "peers"]) {
    const response = await page.request.get("/api/research/005930/" + section);
    expect(response.ok()).toBeTruthy();
    expect(await response.json()).toMatchObject({
      symbol: "005930",
      section,
      status: "ok",
      source: "demo",
    });
  }
  const response = await page.request.get("/api/research/005930/dart");
  expect(await response.json()).toMatchObject({
    status: "unconfigured",
    data: null,
    source: "dart",
  });
});
test("필요할 때만 분석 조회하며 모든 메뉴가 모바일과 PC에서 잘리지 않는다", async ({
  page,
}) => {
  test.setTimeout(120000);
  const requests: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/research/")) requests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "/?page=trade");
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "종목 분석", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "손익계산서", exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
  for (const width of [1440, 1024, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of [
      "투자자 수급",
      "기업 비교",
      "공시·배당",
      "예상 실적",
      "공시 재무",
    ]) {
      await menu(page, name).click();
      await expect(page.locator(".financial-loading")).toHaveCount(0);
      await noOverflow(page);
      if (name === "공시 재무")
        await expect(page.locator(".research-pending")).toContainText(
          "연결 대기",
        );
      if (name === "예상 실적") {
        await expect(
          page.locator(".research-estimates .estimated"),
        ).toHaveCount(3);
        await expect(page.locator(".research-estimates .actual")).toHaveCount(
          2,
        );
      }
      if (name === "투자자 수급")
        await expect(page.locator(".research-summary")).toContainText(
          "외국인 순매수",
        );
      if (
        [1440, 390, 320].includes(width) &&
        ["투자자 수급", "예상 실적", "공시·배당"].includes(name)
      ) {
        await page
          .locator(".research-tabs")
          .evaluate((element) => element.scrollIntoView({ block: "start" }));
        await page.screenshot({
          path: `artifacts/research-ui-${width}-${name}.png`,
        });
      }
    }
    await expect(page.locator(".order-submit-bar")).not.toBeVisible();
  }
  expect(errors).toEqual([]);
});
test("단일 분기와 TTM이 누적값·연간값과 구분되고 전분기를 비교한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await login(page);
  await page.getByRole("button", { name: "단일 분기", exact: true }).click();
  await expect(page.locator(".financial-earnings h3")).toContainText(
    "단일 분기 실적 · 추정",
  );
  const income = page.getByRole("table", { name: "손익계산서", exact: true });
  await expect(
    income
      .getByRole("row")
      .filter({
        has: page.getByRole("rowheader", { name: "매출액", exact: true }),
      })
      .getByRole("cell")
      .first(),
  ).toHaveText("600,000");
  await expect(page.locator(".financial-earnings")).toContainText("전분기");
  await expect(
    page.getByRole("table", { name: "재무비율", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "최근 12개월", exact: true }).click();
  await expect(page.locator(".financial-earnings h3")).toContainText(
    "최근 12개월 실적 · 추정",
  );
  await expect(
    income
      .getByRole("row")
      .filter({
        has: page.getByRole("rowheader", { name: "매출액", exact: true }),
      })
      .getByRole("cell")
      .first(),
  ).toHaveText("2,400,000");
  await expect(page.locator(".financial-basis")).toContainText(
    "연결·별도 구분",
  );
  await noOverflow(page);
});
test("기업을 검색해 추가·제거하고 3개 기업을 동일 결산으로 비교한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await login(page);
  await menu(page, "기업 비교").click();
  for (const name of ["SK하이닉스", "NAVER"]) {
    await page.getByLabel("비교 기업 검색").fill(name);
    await page
      .locator(".research-search-results")
      .getByRole("button")
      .filter({ hasText: name })
      .click();
  }
  await expect(page.locator(".research-peer-card")).toHaveCount(3);
  await expect(page.getByLabel("비교 기업 검색")).toBeDisabled();
  await expect(page.locator(".research-peer-card").first()).toContainText(
    "삼성전자",
  );
  await noOverflow(page);
  await page.getByRole("button", { name: "NAVER 비교에서 제거" }).click();
  await expect(page.locator(".research-peer-card")).toHaveCount(2);
  await expect(page.getByLabel("비교 기업 검색")).toBeEnabled();
});
test("DART 연결 후 회계 기준을 전환하고 공시 원문·정정 분류를 확인한다", async ({
  page,
}) => {
  await page.route("**/api/research/*/dart?*", async (route) => {
    const url = new URL(route.request().url()),
      basis = url.searchParams.get("basis"),
      year = +url.searchParams.get("year")!,
      report = url.searchParams.get("report");
    await route.fulfill({
      json: {
        symbol: "005930",
        section: "dart",
        status: "ok",
        source: "dart",
        receivedAt: Date.now(),
        data: {
          year,
          report,
          basis,
          receipt: "20250814000001",
          cashflow: {
            operating: basis === "CFS" ? 100 : 50,
            investing: -25,
            financing: null,
          },
          accounts: [
            {
              id: "cash",
              name: "영업활동현금흐름",
              section: "CF",
              current: basis === "CFS" ? 10000000000 : 5000000000,
              previous: 0,
              cumulative: null,
              currency: "KRW",
              currentLabel: "당기",
              previousLabel: "전기",
            },
          ],
        },
      },
    });
  });
  await page.route("**/api/research/*/filings?*", (route) =>
    route.fulfill({
      json: {
        symbol: "005930",
        section: "filings",
        status: "ok",
        source: "dart",
        receivedAt: Date.now(),
        data: {
          from: "20260611",
          to: "20260911",
          total: 2,
          rows: [
            {
              id: "20260911000001",
              date: "20260911",
              title: "[기재정정] 현금배당 결정",
              category: "정정공시",
              url: "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260911000001",
            },
            {
              id: "20260910000001",
              date: "20260910",
              title: "사업보고서",
              category: "실적·보고서",
              url: "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260910000001",
            },
          ],
        },
      },
    }),
  );
  await page.setViewportSize({ width: 320, height: 900 });
  await login(page);
  await menu(page, "공시 재무").click();
  await expect(page.locator(".research-summary")).toContainText("100억 원");
  await page.getByLabel("공시 회계 기준").selectOption("OFS");
  await expect(page.locator(".research-summary")).toContainText("50억 원");
  await expect(page.locator(".research-dart-accounts")).toContainText(
    "영업활동현금흐름",
  );
  await expect(
    page.getByRole("link", { name: "공시 원문", exact: true }),
  ).toHaveAttribute(
    "href",
    "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20250814000001",
  );
  await noOverflow(page);
  await menu(page, "공시·배당").click();
  await expect(page.locator(".research-filings li")).toHaveCount(2);
  await page.getByRole("button", { name: "정정공시", exact: true }).click();
  await expect(page.locator(".research-filings li")).toHaveCount(1);
  await noOverflow(page);
});
test("수급 일부 누락·지연·종목 변경을 이전 값과 혼동하지 않는다", async ({
  page,
}) => {
  await page.route("**/api/research/*/flows?*", (route) =>
    route.fulfill({
      json: {
        symbol: "005930",
        section: "flows",
        status: "stale",
        source: "kis",
        receivedAt: Date.UTC(2026, 8, 9),
        data: {
          rows: [
            {
              date: "20260909",
              close: 100,
              foreign: 0,
              institution: -12,
              individual: null,
            },
          ],
          pendingDates: ["20260910"],
        },
      },
    }),
  );
  await login(page);
  await menu(page, "투자자 수급").click();
  await expect(page.locator(".research-summary")).toContainText("자료 부족");
  await expect(page.locator(".stock-research")).toContainText(
    "2026.09.10 수급은 아직 집계되지 않았습니다",
  );
  await page.getByRole("button", { name: "최근 1거래일", exact: true }).click();
  await expect(page.locator(".research-summary")).toContainText("-12");
  await expect(page.locator(".financial-notice").first()).toContainText(
    "이전 조회 자료",
  );
  await page.goto("/?page=trade&tab=financials&symbol=000660");
  await menu(page, "투자자 수급").click();
  await expect(page.getByRole("alert")).toContainText(
    "선택한 종목의 자료를 다시 조회",
  );
  await expect(page.locator(".research-summary")).toHaveCount(0);
});
