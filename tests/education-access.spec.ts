import { test, expect } from "@playwright/test";

for (const width of [1440, 320]) {
  test(`일반 회원 교육 직접 링크·새로고침·메뉴 차단 (${width}px)`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const username = "education_" + crypto.randomUUID().slice(0, 8);
    const registration = await request.post("/api/register", {
      headers: { "X-Study-Client": "web" },
      data: {
        username,
        name: "교육 권한 검증",
        password: "Study!2026",
        invite: "STUDY2026",
      },
    });
    expect(registration.ok()).toBeTruthy();
    expect((await registration.json()).user.role).toBe("member");
    const educationRequests: string[] = [],
      errors: string[] = [];
    page.on("request", (r) => {
      if (/\/assets\/InvestmentEducation-.*\.js/.test(r.url()))
        educationRequests.push(r.url());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/#education/week/8");
    await page.getByLabel("아이디", { exact: true }).fill(username);
    await page.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    const nav = page.getByRole("navigation", { name: "주요 메뉴" });
    const assertDenied = async () => {
      await expect(
        nav.getByRole("button", { name: "트레이딩", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await expect(
        nav.getByRole("button", { name: "투자 교육", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator(".education-page")).toHaveCount(0);
      await expect(page).not.toHaveURL(/#education/);
    };
    await assertDenied();
    await page.goto("/#education/week/4");
    await page.reload();
    await assertDenied();
    await nav
      .getByRole("button", { name: "내 투자 계좌", exact: true })
      .click();
    await page.evaluate(() => {
      location.hash = "education/week/2";
    });
    await assertDenied();
    await page.evaluate(() => {
      location.hash = "education/week/1";
    });
    await assertDenied();
    if (width === 320) {
      await expect(nav.getByRole("button")).toHaveCount(4);
      const widths = await nav
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.map((b) => b.getBoundingClientRect().width),
        );
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
      await nav.getByRole("button", { name: "더보기", exact: true }).click();
      const menu = page.getByRole("dialog", {
        name: "더보기 메뉴",
        exact: true,
      });
      await expect(menu).toBeVisible();
      await expect(
        menu.getByRole("button", { name: "투자 교육", exact: true }),
      ).toHaveCount(0);
    }
    expect(educationRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}
