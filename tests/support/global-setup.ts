import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Aplica migraciones a la BD de pruebas una vez antes de todos los archivos. */
export default async function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? "postgres://finanzas:finanzas@127.0.0.1:5434/finanzas_test";
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client`select 1`;
  } catch {
    throw new Error(
      `No hay BD de pruebas en ${url}. Levántala con: pnpm db:up  (servicio db-test, puerto 5434)`,
    );
  }
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  await client.end();
}
