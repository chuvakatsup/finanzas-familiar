import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { accounts, categories } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { type Actor, AuthzError } from "@/server/authz";
import { assertUuid } from "@/server/ids";
import { type CategoryKind, DEFAULT_CATEGORIES } from "@/domain/categories";

/**
 * Deja lista la cuenta de una persona nueva: categorías predeterminadas y una cuenta "Efectivo".
 * Es idempotente: si ya tiene algo, no lo duplica.
 */
export async function ensureUserDefaults(db: DbOrTx, userId: string) {
  const [hasCategory] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.userId, userId))
    .limit(1);
  if (!hasCategory) {
    const rows = (Object.keys(DEFAULT_CATEGORIES) as CategoryKind[]).flatMap((kind) =>
      DEFAULT_CATEGORIES[kind].map((c, i) => ({ userId, kind, name: c.name, icon: c.icon, sortOrder: i })),
    );
    await db.insert(categories).values(rows);
  }
  const [hasAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);
  if (!hasAccount) {
    await db.insert(accounts).values({ userId, kind: "efectivo", name: "Efectivo", openingBalance: 0 });
  }
}

export type CategoryRow = {
  id: string;
  kind: CategoryKind;
  name: string;
  icon: string;
  archived: boolean;
};

export async function listCategories(
  db: DbOrTx,
  actor: Actor,
  kind: CategoryKind,
  opts: { includeArchived?: boolean } = {},
): Promise<CategoryRow[]> {
  const rows = await db
    .select({
      id: categories.id,
      kind: categories.kind,
      name: categories.name,
      icon: categories.icon,
      archivedAt: categories.archivedAt,
    })
    .from(categories)
    .where(
      and(
        eq(categories.userId, actor.id),
        eq(categories.kind, kind),
        opts.includeArchived ? undefined : isNull(categories.archivedAt),
      ),
    )
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  return rows.map(({ archivedAt, ...r }) => ({ ...r, archived: archivedAt != null }));
}

/** Categoría del actor (o error). Úsese para validar ids que vienen del formulario. */
export async function getOwnedCategory(db: DbOrTx, actor: Actor, id: string, kind?: CategoryKind) {
  assertUuid(id, "No encontramos esa categoría.");
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.userId, actor.id)))
    .limit(1);
  if (!row || (kind && row.kind !== kind)) throw new AuthzError("No encontramos esa categoría.");
  return row;
}

async function assertUniqueName(db: DbOrTx, actor: Actor, kind: CategoryKind, name: string, exceptId?: string) {
  const [dup] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.userId, actor.id),
        eq(categories.kind, kind),
        isNull(categories.archivedAt),
        sql`lower(${categories.name}) = lower(${name})`,
        exceptId ? sql`${categories.id} <> ${exceptId}` : undefined,
      ),
    )
    .limit(1);
  if (dup) throw new AuthzError(`Ya tienes una categoría llamada “${name}”.`);
}

export async function createCategory(
  db: DbOrTx,
  actor: Actor,
  input: { kind: CategoryKind; name: string; icon: string },
) {
  await assertUniqueName(db, actor, input.kind, input.name);
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${categories.sortOrder}), 0)::int` })
    .from(categories)
    .where(and(eq(categories.userId, actor.id), eq(categories.kind, input.kind)));
  const [row] = await db
    .insert(categories)
    .values({ userId: actor.id, ...input, sortOrder: max + 1 })
    .returning();
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "category",
    entityId: row.id,
    action: "crear",
    after: row,
  });
  return row;
}

export async function updateCategory(db: DbOrTx, actor: Actor, id: string, input: { name: string; icon: string }) {
  const before = await getOwnedCategory(db, actor, id);
  await assertUniqueName(db, actor, before.kind, input.name, id);
  const [after] = await db
    .update(categories)
    .set(input)
    .where(and(eq(categories.id, id), eq(categories.userId, actor.id)))
    .returning();
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "category",
    entityId: id,
    action: "editar",
    before,
    after,
  });
  return after;
}

/** Ocultar (no borrar): los movimientos viejos conservan su categoría. */
export async function setCategoryArchived(db: DbOrTx, actor: Actor, id: string, archived: boolean) {
  const before = await getOwnedCategory(db, actor, id);
  if (!archived) await assertUniqueName(db, actor, before.kind, before.name, id);
  await db
    .update(categories)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(categories.id, id), eq(categories.userId, actor.id)));
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "category",
    entityId: id,
    action: archived ? "borrar" : "restaurar",
  });
}
