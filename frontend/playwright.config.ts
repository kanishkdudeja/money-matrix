import { defineConfig, devices } from "@playwright/test";

const databaseURL = process.env.E2E_DATABASE_URL
  ?? process.env.TEST_DATABASE_URL
  ?? "postgres://money_matrix:money_matrix_local@localhost:4321/money_matrix_test?sslmode=disable";
const apiOrigin = "http://127.0.0.1:18080";
const appOrigin = "http://127.0.0.1:5174";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: appOrigin,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "go run ./cmd/api",
      cwd: "../backend",
      env: {
        DATABASE_URL: databaseURL,
        HTTP_ADDR: "127.0.0.1:18080",
        APP_ENV: "test",
        CORS_ALLOWED_ORIGIN: appOrigin,
      },
      url: `${apiOrigin}/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5174",
      env: { VITE_API_PROXY_TARGET: apiOrigin },
      url: appOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
