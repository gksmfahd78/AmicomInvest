import { test, expect } from "@playwright/test";
test("관리자 지급 → 모의 매수·매도 → 지정가 취소 및 회원 권한", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "반가워요, 투자자님" }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/login.png", fullPage: true });
  await page.getByLabel("아이디", { exact: true }).fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "시장을 읽고, 투자를 연습해요." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "관리자", exact: true }).click();
  await page.getByLabel("지급 대상").selectOption("1");
  await page
    .getByRole("button", { name: "가상 투자금 지급", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("지급했습니다");
  await page.getByRole("button", { name: "트레이딩", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "삼성전자 매수", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("주문 수량", { exact: true }).fill("2");
  await page.getByLabel("매매 이유").fill("반도체 실적을 관찰하기 위한 연습");
  await page
    .getByRole("button", { name: "삼성전자 매수", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("체결되었습니다");
  await expect(page.locator("tbody").first()).toContainText("2주");
  await page.screenshot({ path: "artifacts/trading.png", fullPage: true });
  await page.getByRole("button", { name: "매도", exact: true }).click();
  await page.getByLabel("주문 수량", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "삼성전자 매도", exact: true })
    .click();
  await expect(page.locator("tbody").first()).toContainText("1주");
  await page.getByRole("button", { name: "매수", exact: true }).click();
  await page.getByLabel("주문 유형").selectOption("limit");
  await page.getByLabel("주문 가격", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "삼성전자 매수", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("접수되었습니다");
  await page.getByRole("button", { name: /주문 내역/ }).click();
  await expect(page.locator(".order-status.pending")).toHaveCount(1);
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.locator(".order-status.pending")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const member = await browser.newContext();
  const memberPage = await member.newPage();
  await memberPage.goto("/");
  await memberPage.getByRole("button", { name: "초대 코드로 가입" }).click();
  await memberPage.getByLabel("이름", { exact: true }).fill("테스트 멤버");
  await memberPage.getByLabel("아이디", { exact: true }).fill("member_test");
  await memberPage.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
  await memberPage.getByLabel("스터디 초대 코드").fill("STUDY2026");
  await memberPage.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(
    memberPage.getByRole("heading", { name: "시장을 읽고, 투자를 연습해요." }),
  ).toBeVisible();
  await expect(
    memberPage.getByRole("button", { name: "관리자", exact: true }),
  ).toHaveCount(0);
  const forbidden = await memberPage.request.post("/api/admin/grants", {
    headers: { "X-Study-Client": "web" },
    data: {
      userId: 2,
      amount: 1000,
      note: "forbidden",
      requestId: crypto.randomUUID(),
    },
  });
  expect(forbidden.status()).toBe(403);
  await memberPage
    .getByRole("button", { name: "삼성전자 매수", exact: true })
    .click();
  await expect(memberPage.getByRole("alert")).toContainText("현금이 부족");
  const blocked = await memberPage.request.post("/api/orders", { data: {} });
  expect(blocked.status()).toBe(403);
  await member.close();
  expect(errors).toEqual([]);
});
