import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { accounts, categories, installmentPurchases, transactions } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { type Actor, AuthzError } from "@/server/authz";
import { assertUuid } from "@/server/ids";
import { type AmortRow, installmentPlan } from "@/domain/amortization";
import { firstDueForPurchase } from "@/domain/credit-card";
import { type IsoDate, todayIso } from "@/domain/dates";
import type { Cents } from "@/domain/money";
import { getOwnedCategory } from "./categories";
import { deleteTransaction, restoreTransaction } from "./transactions";

type Purchase = typeof installmentPurchases.$inferSelect;

export type InstallmentStatus = "pagado_previo" | "cubierta" | "pendiente";

export type MsiInput = {
  cardAccountId: string;
  description: string;
  categoryId: string;
  principal: Cents;
  months: number;
  withInterest: boolean;
  annualRateBp: number;
  ivaPct: number;
  purchaseDate: IsoDate;
  /** null = calcularla con el corte y día de pago de la tarjeta. */
  firstDueDate: IsoDate | null;
  /** Mensualidades ya pagadas antes de registrarla en la app. */
  paidBefore: number;
};

export function planOf(p: Pick<Purchase, "principal" | "months" | "withInterest" | "annualRateBp" | "ivaPct" | "firstDueDate">) {
  return installmentPlan({
    principal: p.principal,
    months: p.months,
    withInterest: p.withInterest,
    annualRateBp: p.annualRateBp,
    ivaPct: p.ivaPct,
    firstDueDate: p.firstDueDate,
  });
}

/** Estado de cada mensualidad: pagada antes de la app, ya cargada (su fecha pasó) o pendiente. */
export function installmentStatus(row: AmortRow, paidBefore: number, today: IsoDate): InstallmentStatus {
  if (row.number <= paidBefore) return "pagado_previo";
  return row.dueDate <= today ? "cubierta" : "pendiente";
}

export type MsiSummary = {
  paidCount: number;
  remainingCount: number;
  remainingAmount: Cents;
  total: Cents;
  next: AmortRow | null;
  monthly: Cents;
};

export function summarizePlan(rows: AmortRow[], paidBefore: number, today: IsoDate): MsiSummary {
  const pending = rows.filter((r) => installmentStatus(r, paidBefore, today) === "pendiente");
  return {
    paidCount: rows.length - pending.length,
    remainingCount: pending.length,
    remainingAmount: pending.reduce((s, r) => s + r.payment, 0),
    total: rows.reduce((s, r) => s + r.payment, 0),
    next: pending[0] ?? null,
    monthly: rows[0]?.payment ?? 0,
  };
}

async function getOwnedCard(db: DbOrTx, actor: Actor, id: string) {
  assertUuid(id, "No encontramos esa tarjeta.");
  const [card] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, actor.id)))
    .limit(1);
  if (!card || card.kind !== "credito") throw new AuthzError("Elige una tarjeta de crédito.");
  return card;
}

export async function createInstallmentPurchase(db: DbOrTx, actor: Actor, input: MsiInput) {
  const card = await getOwnedCard(db, actor, input.cardAccountId);
  if (card.archivedAt) throw new AuthzError("Esa tarjeta está archivada.");
  await getOwnedCategory(db, actor, input.categoryId, "gasto");
  if (input.paidBefore >= input.months) throw new AuthzError("Si ya pagaste todas las mensualidades, no hace falta registrarla.");

  const firstDueDate =
    input.firstDueDate ?? firstDueForPurchase(input.purchaseDate, card.statementDay, card.paymentDueDay);
  const values = {
    userId: actor.id,
    cardAccountId: card.id,
    description: input.description,
    categoryId: input.categoryId,
    principal: input.principal,
    months: input.months,
    withInterest: input.withInterest,
    annualRateBp: input.withInterest ? input.annualRateBp : 0,
    ivaPct: input.withInterest ? input.ivaPct : 0,
    purchaseDate: input.purchaseDate,
    firstDueDate,
    paidBefore: input.paidBefore,
  };
  const [purchase] = await db.insert(installmentPurchases).values(values).returning();
  const rows = planOf(purchase);
  // La deuda de la tarjeta sube por lo que falta pagar (en una compra nueva: todo; si ya iba a medias: lo restante).
  const owed = rows.filter((r) => r.number > input.paidBefore).reduce((s, r) => s + r.payment, 0);
  const [tx] = await db
    .insert(transactions)
    .values({
      userId: actor.id,
      kind: "compra_msi",
      amount: owed,
      // Si ya iba a medias, la deuda restante se registra hoy (lo anterior ya se pagó fuera de la app).
      date: input.paidBefore > 0 ? todayIso() : input.purchaseDate,
      fromAccountId: card.id,
      categoryId: input.categoryId,
      note: `${input.description} (${input.months} meses)`,
      origin: "msi",
      sourceId: purchase.id,
    })
    .returning();
  await db.update(installmentPurchases).set({ transactionId: tx.id }).where(eq(installmentPurchases.id, purchase.id));
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "installment_purchase",
    entityId: purchase.id,
    action: "crear",
    after: { ...purchase, owed },
  });
  return { ...purchase, transactionId: tx.id };
}

async function getOwnedPurchase(db: DbOrTx, actor: Actor, id: string) {
  assertUuid(id, "No encontramos esa compra.");
  const [row] = await db
    .select()
    .from(installmentPurchases)
    .where(and(eq(installmentPurchases.id, id), eq(installmentPurchases.userId, actor.id)))
    .limit(1);
  if (!row) throw new AuthzError("No encontramos esa compra.");
  return row;
}

export type PurchaseView = Purchase & {
  cardName: string;
  categoryName: string | null;
  categoryIcon: string | null;
  rows: (AmortRow & { status: InstallmentStatus })[];
  summary: MsiSummary;
};

function view(p: Purchase, extra: { cardName: string; categoryName: string | null; categoryIcon: string | null }, today: IsoDate): PurchaseView {
  const rows = planOf(p);
  return {
    ...p,
    ...extra,
    rows: rows.map((r) => ({ ...r, status: installmentStatus(r, p.paidBefore, today) })),
    summary: summarizePlan(rows, p.paidBefore, today),
  };
}

export async function listInstallmentPurchases(
  db: DbOrTx,
  actor: Actor,
  opts: { cardAccountId?: string; includeCancelled?: boolean; today?: IsoDate } = {},
): Promise<PurchaseView[]> {
  const today = opts.today ?? todayIso();
  const rows = await db
    .select({ p: installmentPurchases, cardName: accounts.name, categoryName: categories.name, categoryIcon: categories.icon })
    .from(installmentPurchases)
    .innerJoin(accounts, eq(accounts.id, installmentPurchases.cardAccountId))
    .leftJoin(categories, eq(categories.id, installmentPurchases.categoryId))
    .where(
      and(
        eq(installmentPurchases.userId, actor.id),
        opts.cardAccountId ? eq(installmentPurchases.cardAccountId, opts.cardAccountId) : undefined,
        opts.includeCancelled ? undefined : isNull(installmentPurchases.cancelledAt),
      ),
    )
    .orderBy(asc(installmentPurchases.purchaseDate));
  return rows.map((r) => view(r.p, r, today));
}

export async function getInstallmentPurchase(db: DbOrTx, actor: Actor, id: string, today = todayIso()) {
  const p = await getOwnedPurchase(db, actor, id);
  const [card] = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, p.cardAccountId)).limit(1);
  const [cat] = p.categoryId
    ? await db
        .select({ name: categories.name, icon: categories.icon })
        .from(categories)
        .where(eq(categories.id, p.categoryId))
        .limit(1)
    : [];
  return view(p, { cardName: card.name, categoryName: cat?.name ?? null, categoryIcon: cat?.icon ?? null }, today);
}

/** Quitar una compra registrada por error (su deuda sale de la tarjeta). Se puede deshacer. */
export async function cancelInstallmentPurchase(db: DbOrTx, actor: Actor, id: string, cancelled: boolean) {
  const p = await getOwnedPurchase(db, actor, id);
  if (p.transactionId) {
    if (cancelled) await deleteTransaction(db, actor, p.transactionId, { fromSource: true });
    else await restoreTransaction(db, actor, p.transactionId, { fromSource: true });
  }
  await db
    .update(installmentPurchases)
    .set({ cancelledAt: cancelled ? new Date() : null })
    .where(eq(installmentPurchases.id, id));
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "installment_purchase",
    entityId: id,
    action: cancelled ? "borrar" : "restaurar",
  });
}

export type InstallmentDue = {
  purchaseId: string;
  description: string;
  cardAccountId: string;
  categoryId: string | null;
  number: number;
  months: number;
  dueDate: IsoDate;
  amount: Cents;
};

/** Mensualidades (sin las "pagadas antes") con fecha en [from, to]. Para el balance y la tarjeta. */
export async function installmentsBetween(
  db: DbOrTx,
  actor: Actor,
  from: IsoDate,
  to: IsoDate,
  cardAccountId?: string,
): Promise<InstallmentDue[]> {
  const purchases = await db
    .select()
    .from(installmentPurchases)
    .where(
      and(
        eq(installmentPurchases.userId, actor.id),
        isNull(installmentPurchases.cancelledAt),
        cardAccountId ? eq(installmentPurchases.cardAccountId, cardAccountId) : undefined,
      ),
    );
  const out: InstallmentDue[] = [];
  for (const p of purchases) {
    for (const r of planOf(p)) {
      if (r.number <= p.paidBefore || r.dueDate < from || r.dueDate > to) continue;
      out.push({
        purchaseId: p.id,
        description: p.description,
        cardAccountId: p.cardAccountId,
        categoryId: p.categoryId,
        number: r.number,
        months: p.months,
        dueDate: r.dueDate,
        amount: r.payment,
      });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
