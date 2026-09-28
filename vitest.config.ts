import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));
const emptyModule = fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url));

const shared = {
  alias: {
    "@": src,
    // En pruebas no hay "react-server"; se neutraliza el guardián.
    "server-only": emptyModule,
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: shared,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: shared,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/support/global-setup.ts"],
          // Una sola BD compartida: los archivos corren uno tras otro.
          fileParallelism: false,
          env: {
            DATABASE_URL:
              process.env.TEST_DATABASE_URL ??
              "postgres://finanzas:finanzas@127.0.0.1:5434/finanzas_test",
            APP_URL: "http://localhost:3000",
            NODE_ENV: "test",
          },
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
