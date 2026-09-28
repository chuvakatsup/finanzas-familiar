import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { authAttempts } from "@/server/db/schema";

export type AttemptKind = "login-email" | "login-ip" | "token-ip";

export const WINDOW_MINUTES = 15;

/** Máximo de fallos por ventana antes de bloquear temporalmente. */
export const LIMITS: Record<AttemptKind, number> = {
  "login-email": 5,
  "login-ip": 20,
  "token-ip": 20,
};

/**
 * ¿Está bloqueada esta llave? Cuenta fallos en los últimos 15 minutos posteriores al último éxito,
 * así un inicio de sesión correcto "limpia" el contador.
 */
export async function isLimited(db: DbOrTx, kind: AttemptKind, key: string, now = new Date()) {
  const since = new Date(now.getTime() - WINDOW_MINUTES * 60_000);
  const [lastSuccess] = await db
    .select({ at: authAttempts.createdAt })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.kind, kind),
        eq(authAttempts.key, key),
        eq(authAttempts.success, true),
        gt(authAttempts.createdAt, since),
      ),
    )
    .orderBy(desc(authAttempts.createdAt))
    .limit(1);

  const from = lastSuccess?.at ?? since;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.kind, kind),
        eq(authAttempts.key, key),
        eq(authAttempts.success, false),
        gt(authAttempts.createdAt, from),
      ),
    );
  return (row?.n ?? 0) >= LIMITS[kind];
}

export async function recordAttempt(db: DbOrTx, kind: AttemptKind, key: string, success: boolean) {
  await db.insert(authAttempts).values({ kind, key, success });
}

/** Limpieza de registros viejos (se llama de vez en cuando al iniciar sesión). */
export async function pruneAttempts(db: DbOrTx, olderThanDays = 30) {
  await db
    .delete(authAttempts)
    .where(lt(authAttempts.createdAt, new Date(Date.now() - olderThanDays * 86_400_000)));
}
