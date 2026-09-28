import { and, eq, gt, lt } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { sessions, users } from "@/server/db/schema";
import type { Actor } from "@/server/authz";
import { hashToken, newToken } from "./tokens";

/** Sesión larga para que nadie tenga que iniciar sesión a cada rato. */
export const SESSION_DAYS = 60;
/** Si quedan menos de estos días, se extiende otra vez a 60 (sesión "deslizante"). */
const RENEW_WHEN_DAYS_LEFT = 30;
const DAY_MS = 86_400_000;

export type SessionUser = Actor & { name: string; email: string };

export async function createSession(db: DbOrTx, userId: string, userAgent?: string | null) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt,
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

/** Valida el token de la cookie. Devuelve null si no existe, venció o el usuario está inactivo. */
export async function validateSession(db: DbOrTx, token: string, now = new Date()) {
  const id = hashToken(token);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      id: users.id,
      householdId: users.householdId,
      role: users.role,
      name: users.name,
      email: users.email,
      active: users.active,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .limit(1);

  if (!row || !row.active) return null;

  if (row.expiresAt.getTime() - now.getTime() < RENEW_WHEN_DAYS_LEFT * DAY_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY_MS) })
      .where(eq(sessions.id, id));
  }

  const user: SessionUser = {
    id: row.id,
    householdId: row.householdId,
    role: row.role,
    name: row.name,
    email: row.email,
  };
  return user;
}

export async function deleteSession(db: DbOrTx, token: string) {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function deleteUserSessions(db: DbOrTx, userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function pruneExpiredSessions(db: DbOrTx) {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
