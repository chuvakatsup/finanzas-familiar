import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/server/env";
import * as schema from "./schema";

function createDb(url: string) {
  const client = postgres(url, { max: 10, idle_timeout: 30 });
  return { client, db: drizzle(client, { schema }) };
}

type DbBundle = ReturnType<typeof createDb>;
export type Db = DbBundle["db"];
/** Conexión o transacción: los servicios aceptan cualquiera de las dos. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

// En desarrollo, Next recarga módulos; se guarda en globalThis para no abrir conexiones de más.
const g = globalThis as unknown as { __finanzasDb?: DbBundle };

/** Conexión perezosa: no se abre durante `next build`. */
export function getDb(): Db {
  if (!g.__finanzasDb) g.__finanzasDb = createDb(serverEnv().DATABASE_URL);
  return g.__finanzasDb.db;
}

export async function closeDb() {
  if (g.__finanzasDb) {
    await g.__finanzasDb.client.end({ timeout: 5 });
    g.__finanzasDb = undefined;
  }
}

export { schema };
