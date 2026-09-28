import type { DbOrTx } from "@/server/db";
import { auditLog } from "@/server/db/schema";

export type AuditEntry = {
  householdId: string | null;
  actorUserId: string | null;
  entity: string;
  entityId: string;
  action: "crear" | "editar" | "borrar" | "restaurar" | "usar" | "revocar";
  before?: unknown;
  after?: unknown;
};

/** Registra quién hizo qué. Llamar dentro de la misma transacción que el cambio. */
export async function audit(db: DbOrTx, entry: AuditEntry) {
  await db.insert(auditLog).values({
    householdId: entry.householdId,
    actorUserId: entry.actorUserId,
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}

/** Quita campos sensibles antes de guardar en auditoría. */
export function redact<T extends Record<string, unknown>>(row: T): Omit<T, "passwordHash" | "tokenHash"> {
  const copy: Record<string, unknown> = { ...row };
  delete copy.passwordHash;
  delete copy.tokenHash;
  return copy as Omit<T, "passwordHash" | "tokenHash">;
}
