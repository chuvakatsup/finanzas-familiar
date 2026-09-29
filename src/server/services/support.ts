import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbOrTx } from "@/server/db";
import { accounts, loanPayments, loans, supportSchedules, supportTransfers, transactions, users } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { type Actor, AuthzError } from "@/server/authz";
import { assertUuid } from "@/server/ids";
import { APP_TIME_ZONE, type IsoDate, todayIso } from "@/domain/dates";
import type { Cents } from "@/domain/money";
import { type Frequency, type Schedule, addDays, occurrences } from "@/domain/recurrence";
import { ensureCategory } from "./categories";
import { getLoan, payLoanInstallment, prepayLoan, undoLastLoanPayment } from "./loans";
import { deleteTransaction, restoreTransaction } from "./transactions";

type Transfer = typeof supportTransfers.$inferSelect;
type SupportSchedule = typeof supportSchedules.$inferSelect;

export type SupportPurpose = Transfer["purpose"];

export type SendInput = {
  recipientId: string;
  amount: Cents;
  date: IsoDate;
  fromAccountId: string;
  purpose: SupportPurpose;
  note: string | null;
};

/** La otra persona debe ser de MI familia, activa y distinta a mí. Solo se devuelve su nombre. */
async function familyMember(db: DbOrTx, actor: Actor, userId: string) {
  assertUuid(userId, "Elige a quién.");
  if (userId === actor.id) throw new AuthzError("No puedes enviarte un apoyo a ti.");
  const [u] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.householdId, actor.householdId), eq(users.active, true)))
    .limit(1);
  if (!u) throw new AuthzError("No encontramos a esa persona en tu familia.");
  return u;
}

async function ownMoneyAccount(db: DbOrTx, actor: Actor, accountId: string) {
  assertUuid(accountId, "Elige la cuenta.");
  const [acc] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, actor.id)))
    .limit(1);
  if (!acc) throw new AuthzError("No encontramos esa cuenta.");
  if (acc.archivedAt || acc.kind === "credito" || acc.kind === "prestamo") {
    throw new AuthzError("Elige efectivo, débito o ahorro.");
  }
  return acc;
}

async function userName(db: DbOrTx, id: string) {
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, id)).limit(1);
  return u?.name ?? "";
}

async function logSupport(db: DbOrTx, actor: Actor, id: string, action: Parameters<typeof audit>[1]["action"], after?: unknown) {
  await audit(db, { householdId: actor.householdId, actorUserId: actor.id, entity: "support", entityId: id, action, after });
}

/** Enviar apoyo: queda "enviado" y se registra el egreso en mi cuenta. */
export async function sendSupport(db: DbOrTx, actor: Actor, input: SendInput, scheduleId: string | null = null) {
  const recipient = await familyMember(db, actor, input.recipientId);
  const from = await ownMoneyAccount(db, actor, input.fromAccountId);
  const [transfer] = await db
    .insert(supportTransfers)
    .values({
      householdId: actor.householdId,
      senderId: actor.id,
      recipientId: recipient.id,
      amount: input.amount,
      date: input.date,
      note: input.note,
      purpose: input.purpose,
      scheduleId,
    })
    .returning();
  const [tx] = await db
    .insert(transactions)
    .values({
      userId: actor.id,
      kind: "apoyo_enviado",
      amount: input.amount,
      date: input.date,
      fromAccountId: from.id,
      note: `Apoyo a ${recipient.name}`,
      origin: "apoyo",
      sourceId: transfer.id,
    })
    .returning({ id: transactions.id });
  await db.update(supportTransfers).set({ senderTxId: tx.id }).where(eq(supportTransfers.id, transfer.id));
  await logSupport(db, actor, transfer.id, "crear", { ...transfer, senderTxId: tx.id });
  return { ...transfer, senderTxId: tx.id };
}

async function getVisible(db: DbOrTx, actor: Actor, id: string) {
  assertUuid(id, "No encontramos ese apoyo.");
  const [t] = await db
    .select()
    .from(supportTransfers)
    .where(and(eq(supportTransfers.id, id), or(eq(supportTransfers.senderId, actor.id), eq(supportTransfers.recipientId, actor.id))))
    .limit(1);
  if (!t) throw new AuthzError("No encontramos ese apoyo.");
  return t;
}

async function lock(db: DbOrTx, id: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`support:${id}`}))`);
}

/** Solo quien envía, y solo mientras no se haya recibido. */
export async function updateSupport(
  db: DbOrTx,
  actor: Actor,
  id: string,
  input: { amount: Cents; date: IsoDate; note: string | null; fromAccountId: string },
) {
  const t = await getVisible(db, actor, id);
  if (t.senderId !== actor.id) throw new AuthzError("Solo quien envió el apoyo puede cambiarlo.");
  await lock(db, t.id);
  const [fresh] = await db.select().from(supportTransfers).where(eq(supportTransfers.id, t.id));
  if (fresh.status !== "enviado") throw new AuthzError("Ya no se puede cambiar: ya se recibió o se canceló.");
  const from = await ownMoneyAccount(db, actor, input.fromAccountId);
  await db
    .update(supportTransfers)
    .set({ amount: input.amount, date: input.date, note: input.note, updatedAt: new Date() })
    .where(eq(supportTransfers.id, t.id));
  if (fresh.senderTxId) {
    await db
      .update(transactions)
      .set({ amount: input.amount, date: input.date, fromAccountId: from.id, updatedAt: new Date() })
      .where(eq(transactions.id, fresh.senderTxId));
  }
  await logSupport(db, actor, t.id, "editar", input);
}

/** Cancelar (o deshacer la cancelación) de un apoyo que aún no se recibe. */
export async function setSupportCancelled(db: DbOrTx, actor: Actor, id: string, cancelled: boolean) {
  const t = await getVisible(db, actor, id);
  if (t.senderId !== actor.id) throw new AuthzError("Solo quien envió el apoyo puede cancelarlo.");
  await lock(db, t.id);
  const [fresh] = await db.select().from(supportTransfers).where(eq(supportTransfers.id, t.id));
  if (cancelled && fresh.status !== "enviado") throw new AuthzError("Ya no se puede cancelar: ya se recibió.");
  if (!cancelled && fresh.status !== "cancelado") return;
  await db
    .update(supportTransfers)
    .set({ status: cancelled ? "cancelado" : "enviado", updatedAt: new Date() })
    .where(eq(supportTransfers.id, t.id));
  if (fresh.senderTxId) {
    if (cancelled) await deleteTransaction(db, actor, fresh.senderTxId, { fromSource: true });
    else await restoreTransaction(db, actor, fresh.senderTxId, { fromSource: true });
  }
  await logSupport(db, actor, t.id, cancelled ? "borrar" : "restaurar");
}

/** "Todavía no": se deja de preguntar hasta mañana. */
export async function snoozeSupport(db: DbOrTx, actor: Actor, id: string, today = todayIso()) {
  const t = await getVisible(db, actor, id);
  if (t.recipientId !== actor.id) throw new AuthzError();
  await db.update(supportTransfers).set({ snoozedUntil: addDays(today, 1) }).where(eq(supportTransfers.id, t.id));
}

export type ApplyChoice =
  | { kind: "ninguno" }
  | { kind: "tarjeta"; cardId: string }
  | { kind: "cuota"; loanId: string }
  | { kind: "abono"; loanId: string };

/**
 * "Sí, ya lo recibí": ingreso "Apoyo recibido" en la cuenta donde llegó y, si era para una deuda,
 * se aplica a la tarjeta (pago) o al préstamo (siguiente cuota o abono a capital).
 */
export async function receiveSupport(
  db: DbOrTx,
  actor: Actor,
  id: string,
  input: { accountId: string; apply: ApplyChoice },
  today = todayIso(),
) {
  const t = await getVisible(db, actor, id);
  if (t.recipientId !== actor.id) throw new AuthzError("Solo quien recibe el apoyo puede confirmarlo.");
  await lock(db, t.id);
  const [fresh] = await db.select().from(supportTransfers).where(eq(supportTransfers.id, t.id));
  if (fresh.status !== "enviado") throw new AuthzError("Este apoyo ya se confirmó o se canceló.");
  const into = await ownMoneyAccount(db, actor, input.accountId);
  const date = fresh.date <= today ? fresh.date : today;
  const senderName = await userName(db, fresh.senderId);
  const categoryId = await ensureCategory(db, actor.id, "ingreso", "Apoyo familiar", "🤝");
  const [income] = await db
    .insert(transactions)
    .values({
      userId: actor.id,
      kind: "apoyo_recibido",
      amount: fresh.amount,
      date,
      toAccountId: into.id,
      categoryId,
      note: `Apoyo de ${senderName}`,
      origin: "apoyo",
      sourceId: fresh.id,
    })
    .returning({ id: transactions.id });

  let appliedTxId: string | null = null;
  let appliedLoanId: string | null = null;
  const apply = input.apply;
  if (apply.kind === "tarjeta") {
    assertUuid(apply.cardId, "Elige la tarjeta.");
    const [card] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, apply.cardId), eq(accounts.userId, actor.id), eq(accounts.kind, "credito")))
      .limit(1);
    if (!card) throw new AuthzError("No encontramos esa tarjeta.");
    const [pay] = await db
      .insert(transactions)
      .values({
        userId: actor.id,
        kind: "pago_tarjeta",
        amount: fresh.amount,
        date,
        fromAccountId: into.id,
        toAccountId: card.id,
        note: `Pago con apoyo de ${senderName}`,
        origin: "apoyo",
        sourceId: fresh.id,
      })
      .returning({ id: transactions.id });
    appliedTxId = pay.id;
  } else if (apply.kind === "cuota" || apply.kind === "abono") {
    const { loan, summary } = await getLoan(db, actor, apply.loanId);
    appliedLoanId = loan.id;
    if (apply.kind === "cuota") {
      if (!summary.next) throw new AuthzError("Ese préstamo ya no tiene cuotas pendientes.");
      // Se guarda el movimiento de capital de ESE pago para poder deshacerlo con seguridad.
      appliedTxId = (await payLoanInstallment(db, actor, loan.id, summary.next.id, { fromAccountId: into.id, date }, today)).capitalTxId;
    } else {
      const amount = Math.min(fresh.amount, summary.remaining);
      if (amount <= 0) throw new AuthzError("Ese préstamo ya está pagado.");
      appliedTxId = (await prepayLoan(db, actor, loan.id, { amount, date, fromAccountId: into.id, mode: "plazo" })).capitalTxId;
    }
  }

  await db
    .update(supportTransfers)
    .set({
      status: "recibido",
      receivedAt: new Date(),
      recipientTxId: income.id,
      appliedKind: apply.kind,
      appliedTxId,
      appliedLoanId,
      updatedAt: new Date(),
    })
    .where(eq(supportTransfers.id, fresh.id));
  await logSupport(db, actor, fresh.id, "editar", { recibido: true, apply });
}

/** Deshacer la confirmación: vuelve a "enviado" y se quitan el ingreso y lo que se aplicó. */
export async function undoReceiveSupport(db: DbOrTx, actor: Actor, id: string) {
  const t = await getVisible(db, actor, id);
  if (t.recipientId !== actor.id) throw new AuthzError();
  await lock(db, t.id);
  const [fresh] = await db.select().from(supportTransfers).where(eq(supportTransfers.id, t.id));
  if (fresh.status !== "recibido") return;
  if (fresh.appliedLoanId && (fresh.appliedKind === "cuota" || fresh.appliedKind === "abono")) {
    // Solo si ese pago sigue siendo lo último registrado en el préstamo (para que la tabla cuadre).
    const [last] = await db
      .select({ capitalTxId: loanPayments.capitalTxId })
      .from(loanPayments)
      .where(and(eq(loanPayments.loanId, fresh.appliedLoanId), eq(loanPayments.status, "pagado")))
      .orderBy(desc(loanPayments.recordedAt), desc(loanPayments.number))
      .limit(1);
    if (!last || last.capitalTxId !== fresh.appliedTxId) {
      throw new AuthzError("Después registraste otro pago en ese préstamo. Deshazlo primero desde el préstamo.");
    }
    await undoLastLoanPayment(db, actor, fresh.appliedLoanId);
  }
  if (fresh.appliedTxId && fresh.appliedKind === "tarjeta") {
    await deleteTransaction(db, actor, fresh.appliedTxId, { fromSource: true });
  }
  if (fresh.recipientTxId) await deleteTransaction(db, actor, fresh.recipientTxId, { fromSource: true });
  await db
    .update(supportTransfers)
    .set({
      status: "enviado",
      receivedAt: null,
      recipientTxId: null,
      appliedKind: "ninguno",
      appliedTxId: null,
      appliedLoanId: null,
      updatedAt: new Date(),
    })
    .where(eq(supportTransfers.id, fresh.id));
  await logSupport(db, actor, fresh.id, "restaurar", { recibido: false });
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

const senderU = alias(users, "sender_u");
const recipientU = alias(users, "recipient_u");

export type SupportView = Transfer & { senderName: string; recipientName: string; iAmSender: boolean };

export async function listSupports(db: DbOrTx, actor: Actor, opts: { limit?: number } = {}): Promise<SupportView[]> {
  const rows = await db
    .select({ t: supportTransfers, senderName: senderU.name, recipientName: recipientU.name })
    .from(supportTransfers)
    .innerJoin(senderU, eq(senderU.id, supportTransfers.senderId))
    .innerJoin(recipientU, eq(recipientU.id, supportTransfers.recipientId))
    .where(or(eq(supportTransfers.senderId, actor.id), eq(supportTransfers.recipientId, actor.id)))
    .orderBy(desc(supportTransfers.date), desc(supportTransfers.createdAt))
    .limit(opts.limit ?? 200);
  return rows.map((r) => ({ ...r.t, senderName: r.senderName, recipientName: r.recipientName, iAmSender: r.t.senderId === actor.id }));
}

export async function getSupport(db: DbOrTx, actor: Actor, id: string): Promise<SupportView> {
  const t = await getVisible(db, actor, id);
  return {
    ...t,
    senderName: await userName(db, t.senderId),
    recipientName: await userName(db, t.recipientId),
    iAmSender: t.senderId === actor.id,
  };
}

/** Apoyos que me enviaron y debo confirmar (sin los que pospuse con "Todavía no"). */
export async function pendingToConfirm(db: DbOrTx, actor: Actor, today = todayIso()) {
  const all = await listSupports(db, actor);
  return all.filter(
    (s) => !s.iAmSender && s.status === "enviado" && (s.snoozedUntil == null || s.snoozedUntil <= today),
  );
}

/** Para la bandeja: pendientes + los que confirmé HOY (para poder deshacer el resto del día). */
export async function inboxSupports(db: DbOrTx, actor: Actor, today = todayIso()) {
  const all = await listSupports(db, actor);
  return all.filter(
    (s) =>
      !s.iAmSender &&
      ((s.status === "enviado" && (s.snoozedUntil == null || s.snoozedUntil <= today)) ||
        (s.status === "recibido" && s.receivedAt != null && dateInAppZone(s.receivedAt) === today)),
  );
}

// ---------------------------------------------------------------------------
// Apoyos recurrentes
// ---------------------------------------------------------------------------

export type ScheduleInput = SendInput & { frequency: Extract<Frequency, "semanal" | "quincenal" | "mensual"> };

export function supportScheduleOf(s: Pick<SupportSchedule, "frequency" | "startDate" | "day1" | "day2">): Schedule {
  return { frequency: s.frequency, startDate: s.startDate, endDate: null, day1: s.day1, day2: s.day2 };
}

/** Programa un apoyo repetido; la primera fecha es `input.date`. */
export async function createSupportSchedule(db: DbOrTx, actor: Actor, input: ScheduleInput) {
  const recipient = await familyMember(db, actor, input.recipientId);
  await ownMoneyAccount(db, actor, input.fromAccountId);
  const day = Number(input.date.slice(8, 10));
  const [row] = await db
    .insert(supportSchedules)
    .values({
      householdId: actor.householdId,
      senderId: actor.id,
      recipientId: recipient.id,
      amount: input.amount,
      frequency: input.frequency,
      startDate: input.date,
      day1: input.frequency === "semanal" ? null : input.frequency === "quincenal" ? (day <= 15 ? day : day - 15) : day,
      day2: input.frequency === "quincenal" ? (day <= 15 ? Math.min(day + 15, 31) : day) : null,
      fromAccountId: input.fromAccountId,
      purpose: input.purpose,
      note: input.note,
    })
    .returning();
  await logSupport(db, actor, row.id, "crear", row);
  return row;
}

export async function stopSupportSchedule(db: DbOrTx, actor: Actor, id: string) {
  assertUuid(id, "No encontramos ese apoyo.");
  const updated = await db
    .update(supportSchedules)
    .set({ archivedAt: new Date() })
    .where(and(eq(supportSchedules.id, id), eq(supportSchedules.senderId, actor.id)))
    .returning({ id: supportSchedules.id });
  if (!updated.length) throw new AuthzError("Solo quien lo programó puede detenerlo.");
  await logSupport(db, actor, id, "borrar");
}

export async function listSupportSchedules(db: DbOrTx, actor: Actor) {
  const rows = await db
    .select({ s: supportSchedules, senderName: senderU.name, recipientName: recipientU.name })
    .from(supportSchedules)
    .innerJoin(senderU, eq(senderU.id, supportSchedules.senderId))
    .innerJoin(recipientU, eq(recipientU.id, supportSchedules.recipientId))
    .where(
      and(
        isNull(supportSchedules.archivedAt),
        or(eq(supportSchedules.senderId, actor.id), eq(supportSchedules.recipientId, actor.id)),
      ),
    );
  return rows.map((r) => ({ ...r.s, senderName: r.senderName, recipientName: r.recipientName, iAmSender: r.s.senderId === actor.id }));
}

function dateInAppZone(at: Date): IsoDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE }).format(at);
}

/**
 * Genera los apoyos recurrentes cuya fecha ya llegó (en los que participo como quien envía o recibe).
 * Nunca antes del alta ni más de 45 días atrás; no duplica (índice único por fecha).
 */
export async function syncSupportSchedules(db: DbOrTx, actor: Actor, today = todayIso()) {
  const schedules = await db
    .select()
    .from(supportSchedules)
    .where(
      and(
        isNull(supportSchedules.archivedAt),
        eq(supportSchedules.householdId, actor.householdId),
        or(eq(supportSchedules.senderId, actor.id), eq(supportSchedules.recipientId, actor.id)),
      ),
    );
  let created = 0;
  for (const s of schedules) {
    const floor = addDays(today, -45);
    const createdDay = dateInAppZone(s.createdAt);
    const from = [floor, createdDay, s.startDate].sort().at(-1)!;
    const dates = occurrences(supportScheduleOf(s), from, today);
    if (!dates.length) continue;
    const existing = await db
      .select({ date: supportTransfers.date })
      .from(supportTransfers)
      .where(and(eq(supportTransfers.scheduleId, s.id), inArray(supportTransfers.date, dates)));
    const done = new Set(existing.map((e) => e.date));
    const [sender] = await db
      .select({ id: users.id, householdId: users.householdId, role: users.role })
      .from(users)
      .where(eq(users.id, s.senderId));
    for (const date of dates) {
      if (done.has(date)) continue;
      try {
        await db.transaction(async (t) => {
          await t.execute(sql`select pg_advisory_xact_lock(hashtext(${`support-schedule:${s.id}:${date}`}))`);
          const [dup] = await t
            .select({ id: supportTransfers.id })
            .from(supportTransfers)
            .where(and(eq(supportTransfers.scheduleId, s.id), eq(supportTransfers.date, date)))
            .limit(1);
          if (dup) return;
          await sendSupport(
            t,
            sender,
            { recipientId: s.recipientId, amount: s.amount, date, fromAccountId: s.fromAccountId, purpose: s.purpose, note: s.note },
            s.id,
          );
          created++;
        });
      } catch (e) {
        if (!(e instanceof AuthzError)) throw e;
      }
    }
  }
  return created;
}

// ---------------------------------------------------------------------------
// Para el balance del mes
// ---------------------------------------------------------------------------

/**
 * - Como quien recibe: apoyos "enviado" aún sin confirmar y apoyos recurrentes futuros = ingreso esperado
 *   (si la persona lo tiene activado).
 * - Como quien envía: apoyos recurrentes futuros = compromiso.
 */
export async function supportDueBetween(
  db: DbOrTx,
  actor: Actor,
  from: IsoDate,
  to: IsoDate,
  countPending: boolean,
  today = todayIso(),
) {
  const expectedIncome: { amount: Cents; date: IsoDate; from: string }[] = [];
  const commitments: { amount: Cents; date: IsoDate; to: string }[] = [];
  if (countPending) {
    const pending = await db
      .select({ amount: supportTransfers.amount, date: supportTransfers.date, senderName: users.name })
      .from(supportTransfers)
      .innerJoin(users, eq(users.id, supportTransfers.senderId))
      .where(
        and(
          eq(supportTransfers.recipientId, actor.id),
          eq(supportTransfers.status, "enviado"),
          sql`${supportTransfers.date} >= ${from}`,
          lte(supportTransfers.date, to),
        ),
      );
    for (const p of pending) expectedIncome.push({ amount: p.amount, date: p.date, from: p.senderName });
  }
  const futureFrom = from > today ? from : addDays(today, 1);
  if (futureFrom <= to) {
    for (const s of await listSupportSchedules(db, actor)) {
      for (const date of occurrences(supportScheduleOf(s), futureFrom, to)) {
        if (s.iAmSender) commitments.push({ amount: s.amount, date, to: s.recipientName });
        else if (countPending) expectedIncome.push({ amount: s.amount, date, from: s.senderName });
      }
    }
  }
  return { expectedIncome, commitments };
}

/** Deudas propias a las que se puede aplicar un apoyo (solo para quien RECIBE; nunca se muestran a quien envía). */
export async function debtsForApply(db: DbOrTx, actor: Actor) {
  const cards = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.userId, actor.id), eq(accounts.kind, "credito"), isNull(accounts.archivedAt)));
  const loanRows = await db
    .select({ id: loans.id, name: loans.name })
    .from(loans)
    .where(and(eq(loans.userId, actor.id), isNull(loans.archivedAt)));
  return { cards, loans: loanRows };
}
