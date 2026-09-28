import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { households, invitations, users } from "@/server/db/schema";
import { audit, redact } from "@/server/audit";
import { type Actor, AuthzError, assertAdmin } from "@/server/authz";
import { hashPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/sessions";
import { hashToken, newToken, normalizeEmail } from "@/server/auth/tokens";

export const INVITATION_DAYS = 7;

export async function createInvitation(db: DbOrTx, actor: Actor, input: { suggestedName?: string }) {
  assertAdmin(actor);
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 86_400_000);
  const [row] = await db
    .insert(invitations)
    .values({
      householdId: actor.householdId,
      tokenHash: hashToken(token),
      suggestedName: input.suggestedName?.trim() || null,
      createdBy: actor.id,
      expiresAt,
    })
    .returning();
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "invitation",
    entityId: row.id,
    action: "crear",
    after: redact(row),
  });
  return { id: row.id, token, expiresAt };
}

/** Invitaciones vigentes del grupo del actor (solo admin). */
export async function listPendingInvitations(db: DbOrTx, actor: Actor) {
  assertAdmin(actor);
  return db
    .select({
      id: invitations.id,
      suggestedName: invitations.suggestedName,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(
      and(
        eq(invitations.householdId, actor.householdId),
        isNull(invitations.usedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invitations.createdAt));
}

export async function revokeInvitation(db: DbOrTx, actor: Actor, invitationId: string) {
  assertAdmin(actor);
  const updated = await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.id, invitationId),
        eq(invitations.householdId, actor.householdId),
        isNull(invitations.usedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .returning({ id: invitations.id });
  if (!updated.length) throw new AuthzError("Esa invitación ya no existe o ya se usó.");
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "invitation",
    entityId: invitationId,
    action: "revocar",
  });
}

async function findValidInvitation(db: DbOrTx, token: string) {
  const [row] = await db
    .select({
      id: invitations.id,
      householdId: invitations.householdId,
      householdName: households.name,
      suggestedName: invitations.suggestedName,
    })
    .from(invitations)
    .innerJoin(households, eq(households.id, invitations.householdId))
    .where(
      and(
        eq(invitations.tokenHash, hashToken(token)),
        isNull(invitations.usedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getInvitation(db: DbOrTx, token: string) {
  const row = await findValidInvitation(db, token);
  return row ? { householdName: row.householdName, suggestedName: row.suggestedName } : null;
}

export type AcceptResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; error: "invalida" | "correo-existe" };

/** Crea la cuenta del invitado en el grupo de la invitación y abre su sesión. Un solo uso. */
export async function acceptInvitation(
  db: DbOrTx,
  token: string,
  input: { name: string; email: string; password: string },
  userAgent?: string | null,
): Promise<AcceptResult> {
  const inv = await findValidInvitation(db, token);
  if (!inv) return { ok: false, error: "invalida" };

  const email = normalizeEmail(input.email);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return { ok: false, error: "correo-existe" };

  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({ householdId: inv.householdId, name: input.name.trim(), email, passwordHash, role: "miembro" })
    .returning({ id: users.id, name: users.name, email: users.email, role: users.role });

  const used = await db
    .update(invitations)
    .set({ usedAt: new Date(), usedBy: user.id })
    .where(and(eq(invitations.id, inv.id), isNull(invitations.usedAt)))
    .returning({ id: invitations.id });
  // Si otra petición la usó al mismo tiempo, se aborta (el llamador debe estar en transacción).
  if (!used.length) throw new Error("La invitación se usó al mismo tiempo en otra pestaña.");

  await audit(db, {
    householdId: inv.householdId,
    actorUserId: user.id,
    entity: "user",
    entityId: user.id,
    action: "crear",
    after: { ...user, viaInvitation: inv.id },
  });

  const session = await createSession(db, user.id, userAgent);
  return { ok: true, ...session };
}
