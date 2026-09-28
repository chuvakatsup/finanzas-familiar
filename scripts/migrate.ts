/**
 * Aplica migraciones pendientes. Se ejecuta al arrancar el contenedor (antes de server.js)
 * y en desarrollo con `pnpm db:migrate`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: process.env.MIGRATIONS_DIR ?? "drizzle" });
  console.log("✔ Migraciones aplicadas");
} catch (e) {
  console.error("✖ Error al migrar:", e);
  process.exitCode = 1;
} finally {
  await client.end();
}
