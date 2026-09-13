import { openDetails } from "./uiControls";
import { test, expect } from "@playwright/test";

test("모바일 투자 계획 → 주문 → 복기 보존과 위험 시나리오", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("아이디", { exact: true }).fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "차트", exact: true }),
  ).toBeVisible();
  const headers = { "X-Study-Client": "web" };
  const registration = await request.post("/api/register", {
    headers,
    data: {
      username: "journal_ui_" + crypto.randomUUID().slice(0, 8),
      name: "일지 검증 회원",
      password: "Study!2026",
      invite: "STUDY2026",
    },
  });
  const { user } = await registration.json();
  expect(
    (
      await page.request.post("/api/admin/grants", {
        headers,
        data: {
          userId: user.id,
          amount: 10000000,
          note: "학습 검증",
          requestId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.context().addCookies((await request.storageState()).cookies);
  expect(
    (
      await page.request.post("/api/orders", {
        headers,
        data: {
          symbol: "005930",
          side: "buy",
          type: "market",
          quantity: 1,
          requestId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  await page.getByRole("tab", { name: "주문", exact: true }).click();
  await page.getByLabel("주문 유형").selectOption("limit");
  await page.getByLabel("주문 가격", { exact: true }).fill("1");
  await openDetails(page, ".order-notes");
  await page.getByLabel("매매 이유").fill("학습 일지: 실적을 관찰한다");
  await page.locator(".trade-plan-fields summary").click();
  await page
    .getByLabel("예상 보유 기간", { exact: true })
    .fill("다음 분기 발표까지");
  await page
    .getByLabel("판단을 바꿀 조건", { exact: true })
    .fill("주력 사업 매출이 감소할 때");
  await page
    .getByLabel("근거 자료", { exact: true })
    .fill("분기 보고서 · 2026년 2분기");
  await expect(page.locator(".order-weight-preview")).toContainText(
    "종목 비중",
  );
  await page
    .getByRole("button", { name: "삼성전자 매수", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("접수되었습니다");
  await page.getByRole("button", { name: "내 투자 계좌", exact: true }).click();
  await page.getByRole("tab", { name: "성과·일지", exact: true }).click();
  const journal = page.getByRole("region", { name: "투자 일지", exact: true });
  await expect(journal.locator(".journal-card").first()).toBeVisible();
  const card = journal.locator(".journal-card").first();
  await card.locator("summary").click();
  await expect(card).toContainText("다음 분기 발표까지");
  await expect(card).toContainText("주력 사업 매출이 감소할 때");
  await expect(card).toContainText("주문 시 수신 호가");
  await card.getByLabel("계획 준수 여부").selectOption("followed");
  await card
    .getByLabel("판단 평가·매도 이유")
    .fill("미체결 상태에서 근거를 더 확인했다.");
  await card
    .getByLabel("배운 점·다음에 바꿀 점")
    .fill("다음에는 주문 가격과 근거를 함께 확인한다.");
  await card.getByRole("button", { name: "복기 저장" }).click();
  await expect(journal.getByRole("status")).toHaveText("복기를 저장했습니다.");
  await journal.getByLabel("복기 상태").selectOption("reviewed");
  await expect(journal.locator(".journal-card")).toHaveCount(1);
  await journal.locator(".journal-card summary").click();
  await expect(journal.getByLabel("배운 점·다음에 바꿀 점")).toHaveValue(
    "다음에는 주문 가격과 근거를 함께 확인한다.",
  );
  const risk = page.getByRole("region", {
    name: "포트폴리오 위험 분석",
    exact: true,
  });
  await expect(risk).toContainText("현금 비중");
  await risk.getByLabel("가정 하락률").selectOption("20");
  await expect(risk.locator(".risk-scenario")).toContainText("계좌 평가액");
  const performance = page.getByRole("region", {
    name: "계좌 수익률 기록",
    exact: true,
  });
  await performance.getByLabel("손익 집계").selectOption("week");
  await expect(performance).toContainText("추가 지급");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/account-learning-mobile.png",
    fullPage: true,
  });
  await journal.screenshot({ path: "artifacts/account-journal-mobile.png" });
  await risk.screenshot({ path: "artifacts/account-risk-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/account-learning-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("일지 API는 타인의 주문에 접근하거나 최초 계획을 변경하지 못한다", async ({
  request,
  playwright,
}) => {
  const headers = { "X-Study-Client": "web" };
  const admin = await playwright.request.newContext();
  await admin.post("/api/login", {
    headers,
    data: { username: "admin", password: "Study!2026" },
  });
  const { user } = await (
    await request.post("/api/register", {
      headers,
      data: {
        username: "journal_api_" + crypto.randomUUID().slice(0, 8),
        name: "일지 소유자",
        password: "Study!2026",
        invite: "STUDY2026",
      },
    })
  ).json();
  expect(
    (
      await admin.post("/api/admin/grants", {
        headers,
        data: {
          userId: user.id,
          amount: 100000,
          note: "일지 권한 검증",
          requestId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBeTruthy();
  await admin.dispose();
  expect(
    (
      await request.post("/api/orders", {
        headers,
        data: {
          symbol: "005930",
          side: "buy",
          type: "limit",
          limitPrice: 1,
          quantity: 1,
          plan: { horizon: "한 달" },
          requestId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBeTruthy();
  const response = await request.get("/api/journal");
  const entry = (await response.json()).entries[0];
  expect(entry).toBeTruthy();
  const originalPlan = entry.plan;
  const update = await request.post(`/api/journal/${entry.id}`, {
    headers,
    data: {
      revision: entry.revision,
      plan: { horizon: "위조" },
      review: {
        reason: "추가 검토",
        lesson: "원래 계획 보존",
        adherence: "partial",
      },
    },
  });
  expect(update.ok()).toBeTruthy();
  expect(
    (await (await request.get("/api/journal")).json()).entries[0].plan,
  ).toEqual(originalPlan);
  await request.post("/api/register", {
    headers,
    data: {
      username: "learning_" + crypto.randomUUID().slice(0, 8),
      name: "새 회원",
      password: "Study!2026",
      invite: "STUDY2026",
    },
  });
  expect((await (await request.get("/api/journal")).json()).total).toBe(0);
  const forbidden = await request.post(`/api/journal/${entry.id}`, {
    headers,
    data: {
      revision: entry.revision + 1,
      review: { reason: "변경 시도", lesson: "변경", adherence: "broken" },
    },
  });
  expect(forbidden.ok()).toBeFalsy();
});
