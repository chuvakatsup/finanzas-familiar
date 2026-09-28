import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { users } from "@/server/db/schema";
import { getDummyHash, verifyPassword } from "@/server/auth/password";
import { isLimited, pruneAttempts, recordAttempt } from "@/server/auth/rate-limit";
import { createSession, pruneExpiredSessions } from "@/server/auth/sessions";
import { normalizeEmail } from "@/server/auth/tokens";

export type LoginInput = { email: string; password: string; ip: string; userAgent?: string | null };

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; error: "credenciales" | "bloqueado" };

export async function login(db: DbOrTx, input: LoginInput): Promise<LoginResult> {
  const email = normalizeEmail(input.email);

  if ((await isLimited(db, "login-email", email)) || (await isLimited(db, "login-ip", input.ip))) {
    return { ok: false, error: "bloqueado" };
  }

  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash, active: users.active })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Siempre se verifica un hash (real o de relleno) para no revelar si el correo existe.
  const hashToCheck = user?.passwordHash ?? (await getDummyHash());
  const passwordOk = await verifyPassword(hashToCheck, input.password);
  const ok = Boolean(user && user.active && user.passwordHash && passwordOk);

  await recordAttempt(db, "login-email", email, ok);
  await recordAttempt(db, "login-ip", input.ip, ok);

  if (!ok || !user) return { ok: false, error: "credenciales" };

  // Mantenimiento ligero, aprovechando que alguien inició sesión.
  if (Math.random() < 0.05) {
    await pruneAttempts(db);
    await pruneExpiredSessions(db);
  }

  const session = await createSession(db, user.id, input.userAgent);
  return { ok: true, ...session };
}
