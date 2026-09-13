import { test, expect } from "@playwright/test";
import { courseLessons } from "../src/courseLessons";
import { courseDepth } from "../src/courseDepth";
import { investmentCourse, courseSlides } from "../src/investmentCourse";
async function login(page: import("@playwright/test").Page, url = "/") {
  await page.goto(url);
  await page.getByLabel("아이디", { exact: true }).fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("Study!2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}
test("8주 교육 자료·확인 문제·주차 링크와 실습 이동", async ({ page }) => {
  await login(page, "/#education/week/8");
  await expect(
    page.getByRole("heading", {
      name: "8주차 · 최종 발표와 나의 원칙",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".summary-grid")).toHaveCount(0);
  for (const week of investmentCourse) {
    await page
      .getByRole("navigation", { name: "투자 교육 주차" })
      .getByRole("button", { name: new RegExp(week.title) })
      .click();
    await expect(page).toHaveURL(
      new RegExp("#education/week/" + week.week + "$"),
    );
    await expect(page.locator(".course-slide-preview")).toHaveCount(12);
    await expect(page.locator(".course-reading article")).toHaveCount(2);
    await expect(page.locator(".course-worksheet li")).toHaveCount(5);
    const solution = page.locator(".course-case-solution");
    await expect(solution.locator("ol")).toBeHidden();
    await solution.locator("summary").click();
    await expect(solution.locator("ol")).toContainText(
      courseDepth[week.week].caseStudy.solution[0],
    );
    await page.locator(".course-slide-preview > summary").first().click();
    await expect(page.locator(".course-preview-body").first()).toContainText(
      courseSlides(week)[0].example,
    );
    await page
      .getByRole("region", { name: "주차 확인 문제" })
      .getByRole("button", {
        name: new RegExp(
          week.quiz.options[week.quiz.answer].replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
          ),
        ),
      })
      .click();
    await expect(page.locator(".course-answer")).toContainText("맞았습니다.");
  }
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "8주차 · 최종 발표와 나의 원칙",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "내 투자 계좌 열기", exact: true })
    .click();
  await expect(page.locator(".account-panels")).toBeVisible();
  await expect(page).not.toHaveURL(/#education/);
});
test("발표 키보드·모바일·발표자 메모·PDF 인쇄", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "/#education/week/1");
  await page.getByRole("button", { name: "발표 시작", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "1주차 발표", exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "이전 슬라이드", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "전체 화면 전환", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await dialog
    .getByRole("button", { name: "전체 화면 전환", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("heading")).toHaveText(
    courseSlides(investmentCourse[0])[1].title,
  );
  await page.keyboard.press("End");
  await expect(dialog.getByRole("heading")).toHaveText(
    "함께 실습하고 토론합니다",
  );
  await expect(
    dialog.getByRole("button", { name: "다음 슬라이드", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "진행자 메모", exact: true })
    .click();
  await expect(dialog.locator(".course-presenter-notes")).toContainText(
    "현재 화면에도 표시",
  );
  await page.keyboard.press("Home");
  await page.screenshot({
    path: "artifacts/education-presentation-desktop.png",
  });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await expect(
      dialog.getByRole("button", { name: "발표 닫기", exact: true }),
    ).toBeInViewport();
    await expect(
      dialog.getByRole("button", { name: "다음 슬라이드", exact: true }),
    ).toBeInViewport();
  }
  await page.screenshot({
    path: "artifacts/education-presentation-mobile.png",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: "artifacts/education-desktop.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    window.print = () => {};
  });
  for (let week = 1; week <= 8; week++) {
    await page.emulateMedia({ media: "screen" });
    await page.evaluate((value) => {
      location.hash = `education/week/${value}`;
    }, week);
    await expect(
      page.getByRole("region", { name: `${week}주차 학습 자료`, exact: true }),
    ).toBeVisible();
    for (const [mode, label, pages] of [
      ["slides", "슬라이드 PDF", 12],
      ["workbook", "교재·활동지 PDF", 12],
    ] as const) {
      await page.emulateMedia({ media: "screen" });
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.emulateMedia({ media: "print" });
      await expect(page.locator(".sidebar")).toBeHidden();
      await expect(
        page.locator(".course-print-slide header").first(),
      ).toContainText(`${week}주차`);
      const pdf = await page.pdf({
        path: `artifacts/education-practical-week-${week}-${mode}.pdf`,
        preferCSSPageSize: true,
        printBackground: true,
      });
      expect(
        (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length,
        `${week}주차 ${mode} 페이지 수`,
      ).toBe(pages);
    }
  }
  expect(errors).toEqual([]);
});
test("모바일 관리자 5개·회원 4개 메뉴와 교육 권한", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page);
  const nav = page.getByRole("navigation", { name: "주요 메뉴" });
  await expect(nav.getByRole("button")).toHaveCount(5);
  await nav.getByRole("button", { name: "투자 교육", exact: true }).click();
  await page.getByLabel("교육 주차 선택").selectOption("6");
  await expect(
    page.getByRole("heading", { name: "6주차 · 분산투자와 ETF", exact: true }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "더보기", exact: true }).click();
  let menu = page.getByRole("dialog", { name: "더보기 메뉴", exact: true });
  await expect(
    menu.getByRole("button", { name: "관리자", exact: true }),
  ).toBeVisible();
  await menu.getByRole("button", { name: "스터디 랭킹", exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(
    nav.getByRole("button", { name: "더보기", exact: true }),
  ).toHaveClass(/active/);
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      json: { ...data, user: { ...data.user, role: "member" } },
    });
  });
  await page.reload();
  await nav.getByRole("button", { name: "더보기", exact: true }).click();
  menu = page.getByRole("dialog", { name: "더보기 메뉴", exact: true });
  await expect(
    menu.getByRole("button", { name: "관리자", exact: true }),
  ).toHaveCount(0);
  await menu.getByRole("button", { name: "더보기 닫기", exact: true }).click();
  await expect(nav.getByRole("button")).toHaveCount(4);
  await expect(
    nav.getByRole("button", { name: "투자 교육", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    location.hash = "education/week/6";
  });
  await expect(page).not.toHaveURL(/#education/);
  await expect(page.locator(".education-page")).toHaveCount(0);
  await expect(
    nav.getByRole("button", { name: "트레이딩", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: "artifacts/education-member-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await nav.getByRole("button", { name: "더보기", exact: true }).click();
  await menu.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
});

test("모바일 강의 본문·단계별 풀이·연습문제와 주차 변경 초기화", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, "/#education/week/1");
  for (let week = 1; week <= 8; week++) {
    await page.getByLabel("교육 주차 선택").selectOption(String(week));
    const material = courseLessons[week];
    const lessons = page.locator(".course-lesson");
    await expect(lessons).toHaveCount(3);
    await expect(lessons.nth(0).locator(".course-lesson-body")).toBeVisible();
    await expect(lessons.nth(1).locator(".course-lesson-body")).toBeHidden();
    await lessons.nth(1).locator("summary").click();
    await expect(lessons.nth(1)).toContainText(
      material.lessons[1].paragraphs[2],
    );
    const worked = page.getByRole("region", {
      name: "단계별 예제",
      exact: true,
    });
    await expect(worked.locator(".course-worked-steps li")).toHaveCount(0);
    for (let step = 0; step < material.worked.steps.length; step++) {
      await worked
        .getByRole("button", {
          name: step === 0 ? "첫 번째 풀이 보기" : "다음 풀이 보기",
          exact: true,
        })
        .click();
      await expect(worked.locator(".course-worked-steps li").last()).toHaveText(
        material.worked.steps[step],
      );
    }
    await expect(
      worked.getByRole("button", { name: "다음 풀이 보기", exact: true }),
    ).toBeDisabled();
    await expect(worked.locator(".course-takeaway")).toContainText(
      material.worked.conclusion,
    );
    await worked
      .getByRole("button", { name: "다시 풀기", exact: true })
      .click();
    await expect(worked.locator(".course-worked-steps li")).toHaveCount(0);
    await worked
      .getByRole("button", { name: "첫 번째 풀이 보기", exact: true })
      .click();
    const question = page.locator(".course-faq details").first();
    await question.locator("summary").click();
    await expect(question.locator("p")).toHaveText(material.faq[0].answer);
    const exercise = page.locator(".course-exercises article").first();
    await expect(exercise.locator("details p")).toBeHidden();
    await exercise.locator("summary").click();
    await expect(exercise.locator("details p")).toHaveText(
      material.exercises[0].answer,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const table = worked.locator("table");
    expect(
      await table.evaluate((el) => {
        const tableBounds = el.getBoundingClientRect();
        const panelBounds = el
          .closest(".course-seminar")!
          .getBoundingClientRect();
        return (
          tableBounds.right <= panelBounds.right &&
          tableBounds.left >= panelBounds.left &&
          el.scrollWidth <= el.clientWidth + 1
        );
      }),
    ).toBe(true);
    if (week === 4) {
      await page
        .getByRole("button", { name: "강의 본문", exact: true })
        .click();
      await page.screenshot({
        path: "artifacts/education-complete-mobile-lesson.png",
      });
      await page
        .getByRole("button", { name: "단계별 예제", exact: true })
        .click();
      await page.screenshot({
        path: "artifacts/education-complete-mobile-worked.png",
      });
    }
  }
});
