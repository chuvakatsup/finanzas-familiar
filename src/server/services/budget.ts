import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { budgets, categories } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { type Actor, AuthzError } from "@/server/authz";
import type { Cents } from "@/domain/money";

export type BudgetSettings = {
  /** Presupuesto mensual general de gasto variable (null = sin presupuesto). */
  general: Cents | null;
  /** Límite opcional por categoría. */
  byCategory: Record<string, Cents>;
};

export async function getBudgets(db: DbOrTx, actor: Actor): Promise<BudgetSettings> {
  const rows = await db
    .select({ categoryId: budgets.categoryId, amount: budgets.amount })
    .from(budgets)
    .where(eq(budgets.userId, actor.id));
  const out: BudgetSettings = { general: null, byCategory: {} };
  for (const r of rows) {
    if (r.categoryId == null) out.general = r.amount;
    else out.byCategory[r.categoryId] = r.amount;
  }
  return out;
}

/** Reemplaza el presupuesto completo (general + por categoría). Montos en 0/null = sin límite. */
export async function saveBudgets(db: DbOrTx, actor: Actor, input: BudgetSettings) {
  const categoryIds = Object.keys(input.byCategory);
  if (categoryIds.length) {
    const owned = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.userId, actor.id), eq(categories.kind, "gasto"), inArray(categories.id, categoryIds)));
    if (owned.length !== categoryIds.length) throw new AuthzError("No encontramos esa categoría.");
  }
  const before = await getBudgets(db, actor);
  await db.delete(budgets).where(eq(budgets.userId, actor.id));
  const rows = [
    ...(input.general && input.general > 0 ? [{ userId: actor.id, categoryId: null, amount: input.general }] : []),
    ...Object.entries(input.byCategory)
      .filter(([, amount]) => amount > 0)
      .map(([categoryId, amount]) => ({ userId: actor.id, categoryId, amount })),
  ];
  if (rows.length) await db.insert(budgets).values(rows);
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "budget",
    entityId: actor.id,
    action: "editar",
    before,
    after: input,
  });
}
