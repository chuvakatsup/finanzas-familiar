import { and, asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { households, users } from "@/server/db/schema";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/authz";
import { normalizeEmail } from "@/server/auth/tokens";
import { ensureUserDefaults } from "./categories";
import { issuePasswordReset } from "./password-reset";

export type Member = {
  id: string;
  name: string;
  role: "admin" | "miembro";
  /** Solo se incluye para quien administra. */
  email?: string;
  isMe: boolean;
};

/** Miembros del grupo del actor. Solo nombres; ningún dato financiero. */
export async function listMembers(db: DbOrTx, actor: Actor): Promise<Member[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, role: users.role, email: users.email })
    .from(users)
    .where(and(eq(users.householdId, actor.householdId), eq(users.active, true)))
    .orderBy(asc(users.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    email: actor.role === "admin" ? r.email : undefined,
    isMe: r.id === actor.id,
  }));
}

export async function getHousehold(db: DbOrTx, actor: Actor) {
  const [row] = await db
    .select({ id: households.id, name: households.name })
    .from(households)
    .where(eq(households.id, actor.householdId))
    .limit(1);
  return row ?? null;
}

/**
 * Alta inicial desde la línea de comandos: crea el grupo familiar y su admin SIN contraseña,
 * y devuelve un token para que el admin la defina desde el celular.
 */
export async function createHouseholdWithAdmin(
  db: DbOrTx,
  input: { householdName: string; adminName: string; adminEmail: string },
) {
  const email = normalizeEmail(input.adminEmail);
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) throw new Error(`Ya existe un usuario con el correo ${email}`);

  const [household] = await db
    .insert(households)
    .values({ name: input.householdName.trim() })
    .returning();
  const [admin] = await db
    .insert(users)
    .values({ householdId: household.id, name: input.adminName.trim(), email, role: "admin" })
    .returning({ id: users.id, name: users.name, email: users.email, role: users.role });

  await ensureUserDefaults(db, admin.id);

  await audit(db, {
    householdId: household.id,
    actorUserId: null,
    entity: "household",
    entityId: household.id,
    action: "crear",
    after: { household, admin },
  });

  const reset = await issuePasswordReset(db, { userId: admin.id, createdBy: null, householdId: household.id });
  return { household, admin, resetToken: reset.token, resetExpiresAt: reset.expiresAt };
}
