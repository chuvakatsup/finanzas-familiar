import { and, eq, gt, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { passwordResetTokens, users } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { type Actor, AuthzError, assertAdmin } from "@/server/authz";
import { hashPassword } from "@/server/auth/password";
import { createSession, deleteUserSessions } from "@/server/auth/sessions";
import { hashToken, newToken } from "@/server/auth/tokens";

export const RESET_HOURS = 24;

/** Uso interno: crea el token (sin checar permisos). */
export async function issuePasswordReset(
  db: DbOrTx,
  input: { userId: string; createdBy: string | null; householdId: string },
) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + RESET_HOURS * 3_600_000);
  // Un enlace nuevo invalida los anteriores sin usar.
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, input.userId), isNull(passwordResetTokens.usedAt)));
  const [row] = await db
    .insert(passwordResetTokens)
    .values({ userId: input.userId, tokenHash: hashToken(token), createdBy: input.createdBy, expiresAt })
    .returning({ id: passwordResetTokens.id });
  await audit(db, {
    householdId: input.householdId,
    actorUserId: input.createdBy,
    entity: "password_reset",
    entityId: row.id,
    action: "crear",
    after: { userId: input.userId, expiresAt },
  });
  return { token, expiresAt };
}

/** El admin genera un enlace para que un miembro de SU familia ponga contraseña nueva. */
export async function createPasswordResetForMember(db: DbOrTx, actor: Actor, targetUserId: string) {
  assertAdmin(actor);
  const [target] = await db
    .select({ id: users.id, householdId: users.householdId, name: users.name })
    .from(users)
    .where(and(eq(users.id, targetUserId), eq(users.householdId, actor.householdId)))
    .limit(1);
  if (!target) throw new AuthzError();
  const reset = await issuePasswordReset(db, {
    userId: target.id,
    createdBy: actor.id,
    householdId: actor.householdId,
  });
  return { ...reset, name: target.name };
}

async function findValidReset(db: DbOrTx, token: string) {
  const [row] = await db
    .select({
      id: passwordResetTokens.id,
      userId: users.id,
      householdId: users.householdId,
      name: users.name,
      email: users.email,
      hasPassword: users.passwordHash,
    })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashToken(token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
        eq(users.active, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Datos mínimos para mostrar en la pantalla del enlace (o null si no sirve). */
export async function getPasswordReset(db: DbOrTx, token: string) {
  const row = await findValidReset(db, token);
  return row ? { name: row.name, email: row.email, firstTime: !row.hasPassword } : null;
}

/** Guarda la contraseña nueva, cierra todas las sesiones anteriores e inicia una nueva. */
export async function completePasswordReset(
  db: DbOrTx,
  token: string,
  password: string,
  userAgent?: string | null,
) {
  const row = await findValidReset(db, token);
  if (!row) return null;
  const passwordHash = await hashPassword(password);
  // Marca como usado sólo si sigue sin usar (evita doble uso en carrera).
  const used = await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
    .returning({ id: passwordResetTokens.id });
  if (!used.length) return null;
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, row.userId));
  await deleteUserSessions(db, row.userId);
  await audit(db, {
    householdId: row.householdId,
    actorUserId: row.userId,
    entity: "password_reset",
    entityId: row.id,
    action: "usar",
  });
  return createSession(db, row.userId, userAgent);
}
