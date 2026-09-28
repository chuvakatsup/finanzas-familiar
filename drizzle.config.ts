import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://finanzas:finanzas@127.0.0.1:5433/finanzas",
  },
  strict: true,
  verbose: true,
});
