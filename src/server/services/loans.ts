import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { accounts, loanPayments, loans, transactions } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { type Actor, AuthzError } from "@/server/authz";
import { assertUuid } from "@/server/ids";
import { type AmortRow, type Periodicity, buildSchedule } from "@/domain/amortization";
import { type IsoDate, todayIso } from "@/domain/dates";
import type { Cents } from "@/domain/money";
import { ensureCategory } from "./categories";
import { deleteTransaction } from "./transactions";

type Loan = typeof loans.$inferSelect;
type Row = typeof loanPayments.$inferSelect;

export type LoanInput = {
  name: string;
  informal: boolean;
  principal: Cents;
  annualRateBp: number;
  ivaPct: number;
  periodicity: Periodicity;
  nPayments: number;
  firstPaymentDate: IsoDate;
  openingFee: Cents | null;
  catBp: number | null;
  payFromAccountId: string | null;
  /** Préstamo que ya iba corriendo: cuántos pagos ya se hicieron. */
  paidBefore: number;
  /** Opcional: lo que el estado de cuenta dice que se debe hoy (para cuadrar diferencias). */
  currentBalance: Cents | null;
};

async function assertOwnAccount(db: DbOrTx, actor: Actor, id: string, forPaying = true) {
  assertUuid(id, "No encontramos esa cuenta.");
  const [acc] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, actor.id)))
    .limit(1);
  if (!acc) throw new AuthzError("No encontramos esa cuenta.");
  if (forPaying && (acc.kind === "prestamo" || acc.archivedAt)) throw new AuthzError("Elige otra cuenta para pagar.");
  return acc;
}

export async function createLoan(db: DbOrTx, actor: Actor, input: LoanInput) {
  if (input.paidBefore >= input.nPayments) throw new AuthzError("Si ya pagaste todo, no hace falta registrarlo.");
  if (input.payFromAccountId) await assertOwnAccount(db, actor, input.payFromAccountId);
  const rate = input.informal ? 0 : input.annualRateBp;
  const iva = input.informal ? 0 : input.ivaPct;
  const base = {
    annualRateBp: rate,
    ivaPct: iva,
    periodicity: input.periodicity,
    firstDate: input.firstPaymentDate,
  };
  const full = buildSchedule({ ...base, principal: input.principal, nPayments: input.nPayments });
  const k = input.paidBefore;
  const previous = full.slice(0, k);
  let remaining: AmortRow[] = full.slice(k);
  let startBalance = k > 0 ? full[k - 1].balance : input.principal;
  if (input.currentBalance != null && input.currentBalance !== startBalance) {
    // El banco dice otra cosa: se recalcula lo que falta desde ese saldo con los mismos pagos restantes.
    startBalance = input.currentBalance;
    remaining = buildSchedule({
      ...base,
      principal: startBalance,
      nPayments: input.nPayments - k,
      firstDate: full[k].dueDate,
      startNumber: k + 1,
    });
  }

  const [account] = await db
    .insert(accounts)
    .values({ userId: actor.id, kind: "prestamo", name: input.name, openingBalance: -startBalance, sortOrder: 1000 })
    .returning();
  const [loan] = await db
    .insert(loans)
    .values({
      userId: actor.id,
      accountId: account.id,
      payFromAccountId: input.payFromAccountId,
      name: input.name,
      informal: input.informal,
      principal: input.principal,
      annualRateBp: rate,
      ivaPct: iva,
      periodicity: input.periodicity,
      nPayments: input.nPayments,
      firstPaymentDate: input.firstPaymentDate,
      openingFee: input.openingFee,
      catBp: input.catBp,
      startBalance,
      paidBefore: k,
    })
    .returning();
  const toRow = (r: AmortRow, status: Row["status"]) => ({
    loanId: loan.id,
    userId: actor.id,
    kind: "cuota" as const,
    number: r.number,
    dueDate: r.dueDate,
    payment: r.payment,
    capital: r.capital,
    interest: r.interest,
    iva: r.iva,
    balanceAfter: r.balance,
    status,
  });
  await db.insert(loanPayments).values([
    ...previous.map((r) => toRow(r, "pagado_previo")),
    ...remaining.map((r) => toRow(r, "pendiente")),
  ]);
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "loan",
    entityId: loan.id,
    action: "crear",
    after: loan,
  });
  return loan;
}

async function getOwnedLoan(db: DbOrTx, actor: Actor, id: string) {
  assertUuid(id, "No encontramos ese préstamo.");
  const [loan] = await db
    .select()
    .from(loans)
    .where(and(eq(loans.id, id), eq(loans.userId, actor.id)))
    .limit(1);
  if (!loan) throw new AuthzError("No encontramos ese préstamo.");
  return loan;
}

async function rowsOf(db: DbOrTx, loanId: string) {
  return db
    .select()
    .from(loanPayments)
    .where(eq(loanPayments.loanId, loanId))
    .orderBy(asc(loanPayments.dueDate), asc(loanPayments.kind), asc(loanPayments.number));
}

/** Capital que falta = saldo al dar de alta − capital de lo pagado en la app (cuotas y abonos). */
export function remainingCapital(loan: Pick<Loan, "startBalance">, rows: Pick<Row, "status" | "capital">[]) {
  return loan.startBalance - rows.filter((r) => r.status === "pagado").reduce((s, r) => s + r.capital, 0);
}

export type LoanSummary = {
  remaining: Cents;
  totalPaid: Cents;
  interestPaid: Cents;
  interestPending: Cents;
  next: Row | null;
  payoffDate: IsoDate | null;
  paidCount: number;
  totalCount: number;
  done: boolean;
};

export function summarizeLoan(loan: Loan, rows: Row[]): LoanSummary {
  const cuotas = rows.filter((r) => r.kind === "cuota");
  const paid = rows.filter((r) => r.status !== "pendiente");
  const pending = cuotas.filter((r) => r.status === "pendiente");
  const remaining = remainingCapital(loan, rows);
  return {
    remaining,
    totalPaid: paid.reduce((s, r) => s + r.payment, 0),
    interestPaid: paid.reduce((s, r) => s + r.interest + r.iva, 0),
    interestPending: pending.reduce((s, r) => s + r.interest + r.iva, 0),
    next: pending[0] ?? null,
    payoffDate: pending.at(-1)?.dueDate ?? null,
    paidCount: cuotas.filter((r) => r.status !== "pendiente").length,
    totalCount: cuotas.length,
    done: pending.length === 0 || remaining <= 0,
  };
}

export async function getLoan(db: DbOrTx, actor: Actor, id: string) {
  const loan = await getOwnedLoan(db, actor, id);
  const rows = await rowsOf(db, loan.id);
  return { loan, rows, summary: summarizeLoan(loan, rows) };
}

export async function listLoans(db: DbOrTx, actor: Actor, opts: { includeArchived?: boolean } = {}) {
  const list = await db
    .select()
    .from(loans)
    .where(and(eq(loans.userId, actor.id), opts.includeArchived ? undefined : isNull(loans.archivedAt)))
    .orderBy(asc(loans.createdAt));
  if (list.length === 0) return [];
  const all = await db
    .select()
    .from(loanPayments)
    .where(inArray(loanPayments.loanId, list.map((l) => l.id)))
    .orderBy(asc(loanPayments.dueDate), asc(loanPayments.number));
  return list.map((loan) => {
    const rows = all.filter((r) => r.loanId === loan.id);
    return { loan, summary: summarizeLoan(loan, rows) };
  });
}

async function lockLoan(db: DbOrTx, loanId: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`loan:${loanId}`}))`);
}

/** Registra el pago de la siguiente cuota: capital baja la deuda; interés + IVA es un gasto. */
export async function payLoanInstallment(
  db: DbOrTx,
  actor: Actor,
  loanId: string,
  rowId: string,
  opts: { date?: IsoDate; fromAccountId?: string | null } = {},
  today = todayIso(),
) {
  const loan = await getOwnedLoan(db, actor, loanId);
  if (loan.archivedAt) throw new AuthzError("Este préstamo ya no está activo.");
  await lockLoan(db, loan.id);
  const rows = await rowsOf(db, loan.id);
  const next = rows.find((r) => r.kind === "cuota" && r.status === "pendiente");
  if (!next || next.id !== rowId) throw new AuthzError("Paga primero la cuota más antigua pendiente.");
  const fromId = opts.fromAccountId ?? loan.payFromAccountId;
  if (!fromId) throw new AuthzError("Elige con qué cuenta pagaste.");
  const from = await assertOwnAccount(db, actor, fromId);
  const date = opts.date ?? (next.dueDate <= today ? next.dueDate : today);
  const note = `${loan.name} · pago ${next.number}`;

  let capitalTxId: string | null = null;
  let interestTxId: string | null = null;
  if (next.capital > 0) {
    const [tx] = await db
      .insert(transactions)
      .values({
        userId: actor.id,
        kind: "pago_prestamo",
        amount: next.capital,
        date,
        fromAccountId: from.id,
        toAccountId: loan.accountId,
        note,
        origin: "prestamo",
        sourceId: loan.id,
      })
      .returning({ id: transactions.id });
    capitalTxId = tx.id;
  }
  if (next.interest + next.iva > 0) {
    const categoryId = await ensureCategory(db, actor.id, "gasto", "Intereses y comisiones", "💸");
    const [tx] = await db
      .insert(transactions)
      .values({
        userId: actor.id,
        kind: "gasto",
        amount: next.interest + next.iva,
        date,
        fromAccountId: from.id,
        categoryId,
        note: `${note} (intereses e IVA)`,
        origin: "prestamo",
        sourceId: loan.id,
      })
      .returning({ id: transactions.id });
    interestTxId = tx.id;
  }
  await db
    .update(loanPayments)
    .set({ status: "pagado", paidDate: date, capitalTxId, interestTxId, recordedAt: new Date() })
    .where(eq(loanPayments.id, next.id));
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "loan",
    entityId: loan.id,
    action: "editar",
    after: { pagada: next.number, capitalTxId, interestTxId },
  });
  return next;
}

/** Deshacer el último pago o abono registrado en la app (en orden, para que la tabla cuadre). */
export async function undoLastLoanPayment(db: DbOrTx, actor: Actor, loanId: string) {
  const loan = await getOwnedLoan(db, actor, loanId);
  await lockLoan(db, loan.id);
  const [last] = await db
    .select()
    .from(loanPayments)
    .where(and(eq(loanPayments.loanId, loan.id), eq(loanPayments.status, "pagado")))
    .orderBy(desc(loanPayments.recordedAt), desc(loanPayments.number))
    .limit(1);
  if (!last) throw new AuthzError("No hay pagos para deshacer.");
  for (const txId of [last.capitalTxId, last.interestTxId]) {
    if (txId) await deleteTransaction(db, actor, txId, { fromSource: true });
  }
  if (last.kind === "abono") {
    await db.delete(loanPayments).where(eq(loanPayments.id, last.id));
    await rebuildPending(db, loan, "original");
  } else {
    await db
      .update(loanPayments)
      .set({ status: "pendiente", paidDate: null, capitalTxId: null, interestTxId: null, recordedAt: null })
      .where(eq(loanPayments.id, last.id));
  }
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "loan",
    entityId: loan.id,
    action: "restaurar",
    after: { deshecho: last.kind, numero: last.number },
  });
  return last;
}

export type PrepayMode = "plazo" | "cuota";

/**
 * Recalcula las cuotas pendientes con el capital que falta:
 * - "cuota": mismo número de pagos, cuota más baja.
 * - "plazo": misma cuota, se termina antes.
 */
async function rebuildPending(db: DbOrTx, loan: Loan, mode: PrepayMode | "original") {
  const rows = await rowsOf(db, loan.id);
  const pending = rows.filter((r) => r.kind === "cuota" && r.status === "pendiente");
  if (pending.length === 0) return;
  // "original" (al deshacer un abono): vuelve al plazo del contrato. Si no, se respeta el plazo actual.
  const count = mode === "original" ? loan.nPayments - pending[0].number + 1 : pending.length;
  const remaining = remainingCapital(loan, rows);
  await db.delete(loanPayments).where(inArray(loanPayments.id, pending.map((r) => r.id)));
  if (remaining <= 0) return;
  const rebuilt = buildSchedule({
    principal: remaining,
    annualRateBp: loan.annualRateBp,
    ivaPct: loan.ivaPct,
    periodicity: loan.periodicity,
    nPayments: count,
    firstDate: pending[0].dueDate,
    startNumber: pending[0].number,
    payment: mode === "plazo" ? pending[0].payment : undefined,
    // ("cuota" y "original" recalculan la cuota para el número de pagos que queda.)
  });
  await db.insert(loanPayments).values(
    rebuilt.map((r) => ({
      loanId: loan.id,
      userId: loan.userId,
      kind: "cuota" as const,
      number: r.number,
      dueDate: r.dueDate,
      payment: r.payment,
      capital: r.capital,
      interest: r.interest,
      iva: r.iva,
      balanceAfter: r.balance,
      status: "pendiente" as const,
    })),
  );
}

/** Abono extra a capital, con recálculo (reducir plazo o reducir cuota). */
export async function prepayLoan(
  db: DbOrTx,
  actor: Actor,
  loanId: string,
  input: { amount: Cents; date: IsoDate; fromAccountId: string; mode: PrepayMode },
) {
  const loan = await getOwnedLoan(db, actor, loanId);
  if (loan.archivedAt) throw new AuthzError("Este préstamo ya no está activo.");
  await lockLoan(db, loan.id);
  const rows = await rowsOf(db, loan.id);
  const remaining = remainingCapital(loan, rows);
  if (input.amount > remaining) {
    throw new AuthzError("El abono es mayor a lo que debes. Revisa el monto.");
  }
  const from = await assertOwnAccount(db, actor, input.fromAccountId);
  const [tx] = await db
    .insert(transactions)
    .values({
      userId: actor.id,
      kind: "pago_prestamo",
      amount: input.amount,
      date: input.date,
      fromAccountId: from.id,
      toAccountId: loan.accountId,
      note: `${loan.name} · abono a capital`,
      origin: "prestamo",
      sourceId: loan.id,
    })
    .returning({ id: transactions.id });
  const abonos = rows.filter((r) => r.kind === "abono").length;
  await db.insert(loanPayments).values({
    loanId: loan.id,
    userId: actor.id,
    kind: "abono",
    number: abonos + 1,
    dueDate: input.date,
    payment: input.amount,
    capital: input.amount,
    interest: 0,
    iva: 0,
    balanceAfter: remaining - input.amount,
    status: "pagado",
    paidDate: input.date,
    capitalTxId: tx.id,
    recordedAt: new Date(),
  });
  await rebuildPending(db, loan, input.mode);
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "loan",
    entityId: loan.id,
    action: "editar",
    after: { abono: input.amount, modo: input.mode },
  });
}

export async function setLoanArchived(db: DbOrTx, actor: Actor, loanId: string, archived: boolean) {
  const loan = await getOwnedLoan(db, actor, loanId);
  const at = archived ? new Date() : null;
  await db.update(loans).set({ archivedAt: at }).where(eq(loans.id, loan.id));
  await db.update(accounts).set({ archivedAt: at }).where(eq(accounts.id, loan.accountId));
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "loan",
    entityId: loan.id,
    action: archived ? "borrar" : "restaurar",
  });
}

export type LoanDue = {
  loanId: string;
  rowId: string;
  name: string;
  number: number;
  totalCount: number;
  dueDate: IsoDate;
  amount: Cents;
  payFromAccountId: string | null;
};

/** Cuotas pendientes con fecha en [from, to] (para el balance y próximos pagos). */
export async function loanDueBetween(db: DbOrTx, actor: Actor, from: IsoDate, to: IsoDate): Promise<LoanDue[]> {
  const rows = await db
    .select({ row: loanPayments, loan: loans })
    .from(loanPayments)
    .innerJoin(loans, eq(loans.id, loanPayments.loanId))
    .where(
      and(
        eq(loanPayments.userId, actor.id),
        eq(loanPayments.kind, "cuota"),
        eq(loanPayments.status, "pendiente"),
        isNull(loans.archivedAt),
        gte(loanPayments.dueDate, from),
        lte(loanPayments.dueDate, to),
      ),
    )
    .orderBy(asc(loanPayments.dueDate));
  return rows.map(({ row, loan }) => ({
    loanId: loan.id,
    rowId: row.id,
    name: loan.name,
    number: row.number,
    totalCount: loan.nPayments,
    dueDate: row.dueDate,
    amount: row.payment,
    payFromAccountId: loan.payFromAccountId,
  }));
}

/** Préstamo ligado a cada cuenta tipo "prestamo" (para enlazar desde Mis cuentas). */
export async function loanIdsByAccount(db: DbOrTx, actor: Actor) {
  const rows = await db.select({ id: loans.id, accountId: loans.accountId }).from(loans).where(eq(loans.userId, actor.id));
  return new Map(rows.map((r) => [r.accountId, r.id]));
}
