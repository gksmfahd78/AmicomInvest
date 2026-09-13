import type { Page } from "@playwright/test";
export async function openDetails(page: Page, selector: string) {
  const chartPanels: Record<string, string> = {
    ".chart-drawing-settings": "그리기",
    ".indicator-picker": "보조지표",
    ".chart-display-settings": "차트 설정",
  };
  if (chartPanels[selector]) {
    if (await page.locator(selector).isVisible()) return;
    if (await page.locator(".chart-control-panel").isVisible())
      await page
        .getByRole("button", { name: "차트 도구 닫기", exact: true })
        .click();
    await page
      .getByRole("navigation", { name: "차트 도구" })
      .getByRole("button", { name: chartPanels[selector], exact: true })
      .click();
    return;
  }
  const details = page.locator(selector);
  if ((await details.getAttribute("open")) === null)
    await details.locator(":scope > summary").click();
}
export async function toggleChartSettings(page: Page, selector: string) {
  if (await page.locator(selector).isVisible())
    await page
      .getByRole("button", { name: "차트 도구 닫기", exact: true })
      .click();
  else await openDetails(page, selector);
}
