import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://finanzas:finanzas@127.0.0.1:5434/finanzas_test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Celular Android pequeño: el ancho mínimo que debe verse bien.
    ...devices["Pixel 5"],
    viewport: { width: 360, height: 800 },
    locale: "es-MX",
    timezoneId: "America/Mazatlan",
    trace: "retain-on-failure",
  },
  projects: [{ name: "movil-360", use: { browserName: "chromium" } }],
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      DATABASE_URL: TEST_DB,
      APP_URL: `http://localhost:${PORT}`,
      COOKIE_SECURE: "false",
    },
  },
});
