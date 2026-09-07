import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3101",
    browserName: "chromium",
    channel: "msedge",
    headless: true,
    viewport: { width: 1512, height: 1100 },
  },
  webServer: {
    command: "npx tsx server/index.ts",
    url: "http://127.0.0.1:3101/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "3101",
      DATABASE_PATH: ":memory:",
      MARKET_PROVIDER: "demo",
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "Study!2026",
      STUDY_INVITE_CODE: "STUDY2026",
    },
  },
});
