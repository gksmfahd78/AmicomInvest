import { test, expect } from "@playwright/test";

test("호가와 주문은 뉴스 앞에서 나란히 보이고 넓은 화면에서는 차트 옆에 위치한다", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const login = await page.request.post("/api/login", {
    headers: { "X-Study-Client": "web" },
    data: { username: "admin", password: "Study!2026" },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto("/?page=trade");
  for (const width of [1920, 1600, 1440, 1251, 1250, 1024, 850, 768, 601]) {
    await page.setViewportSize({ width, height: 1000 });
    const book = page.locator(".book-panel"),
      order = page.locator(".order-panel");
    await expect(book).toBeVisible();
    await expect(book.locator(".book-row").first()).toBeVisible();
    await expect(page.locator(".book-panel")).toHaveCount(1);
    const b = (await book.boundingBox())!,
      o = (await order.boundingBox())!;
    expect(Math.abs(b.y - o.y)).toBeLessThanOrEqual(1);
    expect(b.x + b.width).toBeLessThanOrEqual(o.x);
    expect(b.y + b.height).toBeLessThanOrEqual(
      (await page.locator(".stock-news-panel").boundingBox())!.y,
    );
    if (width >= 1251) {
      const c = (await page.locator(".chart-panel").boundingBox())!;
      expect(Math.abs(b.y - c.y)).toBeLessThanOrEqual(1);
      expect(c.x + c.width).toBeLessThanOrEqual(b.x);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const last = book.locator(".book-row").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => scrollTo(0, 0));
    if ([1440, 768].includes(width))
      await page.screenshot({
        path: `artifacts/book-layout-${width}.png`,
        fullPage: width === 768,
      });
  }
  expect(errors).toEqual([]);
});

test("호가 선택은 수량과 매도 방향을 유지하고 지정가 입력만 바꾼다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.request.post("/api/login", {
    headers: { "X-Study-Client": "web" },
    data: { username: "admin", password: "Study!2026" },
  });
  await page.goto("/?page=trade");
  await page.getByRole("button", { name: "매도", exact: true }).click();
  await page.getByLabel("주문 수량", { exact: true }).fill("7");
  let orderRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/orders"
    )
      orderRequests++;
  });
  const row = page.locator(".book-row.bid").first();
  const price = (await row.locator("b").innerText()).replaceAll(",", "");
  await row.click();
  await expect(page.getByLabel("주문 유형")).toHaveValue("limit");
  await expect(page.getByLabel("주문 가격", { exact: true })).toHaveValue(
    price,
  );
  await expect(page.getByLabel("주문 수량", { exact: true })).toHaveValue("7");
  await expect(
    page.getByRole("button", { name: "매도", exact: true }),
  ).toHaveClass(/active/);
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("주문 가격", { exact: true }).fill("1");
  await expect(page.locator('.book-row[aria-pressed="true"]')).toHaveCount(0);
  expect(orderRequests).toBe(0);
});
