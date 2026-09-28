import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { accounts, scheduledItems, transactions } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { type Actor, AuthzError } from "@/server/authz";
import {
  type StatementSummary,
  annualFeeTotal,
  dueDateAfter,
  lastStatementDate,
  previousStatementDate,
  statementSummary,
} from "@/domain/credit-card";
import { type IsoDate, todayIso } from "@/domain/dates";
import type { Cents } from "@/domain/money";
import { getAccount } from "./accounts";
import { ensureCategory } from "./categories";
import { installmentsBetween } from "./msi";
import { createScheduled, scheduleOf, setScheduledArchived, updateScheduled } from "./scheduled";
import { nextOccurrence } from "@/domain/recurrence";

/** Saldo interno de una cuenta contando solo movimientos hasta cierta fecha (incluida). */
async function balanceAt(db: DbOrTx, accountId: string, opening: Cents, date: IsoDate) {
  const [row] = await db
    .select({
      inflow: sql<number>`coalesce(sum(case when ${transactions.toAccountId} = ${accountId} then ${transactions.amount} else 0 end), 0)::bigint`.mapWith(Number),
      outflow: sql<number>`coalesce(sum(case when ${transactions.fromAccountId} = ${accountId} then ${transactions.amount} else 0 end), 0)::bigint`.mapWith(Number),
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        lte(transactions.date, date),
        sql`(${transactions.toAccountId} = ${accountId} or ${transactions.fromAccountId} = ${accountId})`,
      ),
    );
  return opening + row.inflow - row.outflow;
}

async function paidToCardAfter(db: DbOrTx, accountId: string, date: IsoDate) {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)::bigint`.mapWith(Number) })
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), eq(transactions.toAccountId, accountId), gt(transactions.date, date)));
  return row.total;
}

export type CardStatement = StatementSummary & {
  statementDate: IsoDate;
  dueDate: IsoDate;
  /** true si la fecha límite ya pasó y todavía falta pagar. */
  overdue: boolean;
};

/**
 * Estado de cuenta estimado del último corte. Requiere día de corte y día de pago.
 * Deuda al corte = saldo al día del corte menos mensualidades de meses que aún no se cobran.
 */
export async function getCardStatement(db: DbOrTx, actor: Actor, cardId: string, today = todayIso()): Promise<CardStatement | null> {
  const card = await getAccount(db, actor, cardId);
  if (card.kind !== "credito" || !card.statementDay || !card.paymentDueDay) return null;
  const statementDate = lastStatementDate(card.statementDay, today);
  const dueDate = dueDateAfter(statementDate, card.paymentDueDay);
  const prevDue = dueDateAfter(previousStatementDate(card.statementDay, statementDate), card.paymentDueDay);

  const debtAtStatement = Math.max(0, -(await balanceAt(db, card.id, card.openingBalance, statementDate)));
  // Mensualidades que se cobran en cortes futuros (no son parte de este estado de cuenta).
  const future = await installmentsBetween(db, actor, addOneDay(dueDate), "9999-12-31", card.id);
  const inThis = await installmentsBetween(db, actor, addOneDay(prevDue), dueDate, card.id);
  const unbilled = future.reduce((s, i) => s + i.amount, 0);
  const msiInStatement = inThis.reduce((s, i) => s + i.amount, 0);
  const statementDebt = Math.max(0, debtAtStatement - unbilled);

  const summary = statementSummary({
    statementDebt,
    msiInStatement: Math.min(msiInStatement, statementDebt),
    paidSinceStatement: await paidToCardAfter(db, card.id, statementDate),
    creditLimit: card.creditLimit,
    annualRateBp: card.interestRateBp,
  });
  return { ...summary, statementDate, dueDate, overdue: today > dueDate && summary.noInterestPaymentLeft > 0 };
}

function addOneDay(d: IsoDate) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

export type AnnualFeeInput = { amount: Cents; nextDate: IsoDate; withIva: boolean } | null;

/**
 * Anualidad de la tarjeta = un pago programado anual (monto + IVA opcional) cargado a la propia
 * tarjeta. "Exenta este año" se maneja con "No aplica esta vez" en próximos pagos.
 */
export async function setAnnualFee(db: DbOrTx, actor: Actor, cardId: string, input: AnnualFeeInput) {
  const card = await getAccount(db, actor, cardId);
  if (card.kind !== "credito") throw new AuthzError("La anualidad solo aplica a tarjetas de crédito.");
  const [row] = await db
    .select({ annualFeeItemId: accounts.annualFeeItemId })
    .from(accounts)
    .where(eq(accounts.id, card.id))
    .limit(1);
  const itemId = row?.annualFeeItemId ?? null;

  if (!input) {
    if (itemId) await setScheduledArchived(db, actor, itemId, true);
    await db.update(accounts).set({ annualFee: null }).where(eq(accounts.id, card.id));
    return;
  }
  const categoryId = await ensureCategory(db, actor.id, "gasto", "Intereses y comisiones", "💸");
  const data = {
    kind: "pago" as const,
    name: `Anualidad ${card.name}${input.withIva ? " (con IVA)" : ""}`,
    amount: annualFeeTotal(input.amount, input.withIva),
    amountIsEstimate: false,
    frequency: "anual" as const,
    nextDate: input.nextDate,
    day1: null,
    day2: null,
    accountId: card.id,
    categoryId,
    // Se carga sola a la tarjeta en su fecha.
    autoRegister: true,
  };
  if (itemId) {
    const [existing] = await db.select().from(scheduledItems).where(eq(scheduledItems.id, itemId)).limit(1);
    if (existing?.archivedAt) await setScheduledArchived(db, actor, itemId, false);
    await updateScheduled(db, actor, itemId, data);
  } else {
    const item = await createScheduled(db, actor, data);
    await db.update(accounts).set({ annualFeeItemId: item.id }).where(eq(accounts.id, card.id));
  }
  await db.update(accounts).set({ annualFee: input.amount, annualFeeIva: input.withIva }).where(eq(accounts.id, card.id));
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "account",
    entityId: card.id,
    action: "editar",
    after: { anualidad: input },
  });
}

/** Anualidad configurada (monto base, IVA y próxima fecha) o null. */
export async function getAnnualFee(db: DbOrTx, actor: Actor, cardId: string, today = todayIso()) {
  const card = await getAccount(db, actor, cardId);
  const [row] = await db
    .select({ fee: accounts.annualFee, iva: accounts.annualFeeIva, item: scheduledItems })
    .from(accounts)
    .innerJoin(scheduledItems, eq(scheduledItems.id, accounts.annualFeeItemId))
    .where(and(eq(accounts.id, card.id), isNull(scheduledItems.archivedAt)))
    .limit(1);
  if (!row || row.fee == null) return null;
  return {
    amount: row.fee,
    withIva: row.iva,
    total: row.item.amount,
    nextDate: nextOccurrence(scheduleOf(row.item), today),
  };
}
