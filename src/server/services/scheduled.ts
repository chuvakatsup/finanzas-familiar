import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { accounts, categories, scheduledItems, scheduledOccurrences, transactions } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { type Actor, AuthzError } from "@/server/authz";
import { assertUuid } from "@/server/ids";
import { APP_TIME_ZONE, type IsoDate, todayIso } from "@/domain/dates";
import type { Cents } from "@/domain/money";
import { monthOf } from "@/domain/months";
import { type Schedule, addDays, isOccurrence, nextOccurrence, occurrences } from "@/domain/recurrence";
import type { ScheduledFormInput } from "@/lib/schemas/finance";
import { getOwnedCategory } from "./categories";
import { createExpense, createIncome, deleteTransaction } from "./transactions";

type Item = typeof scheduledItems.$inferSelect;
export type ScheduleKind = Item["kind"];

/** Cuántos días hacia atrás se muestran fechas sin confirmar. */
export const LOOKBACK_DAYS = 45;

export function scheduleOf(item: Pick<Item, "frequency" | "startDate" | "endDate" | "day1" | "day2">): Schedule {
  return {
    frequency: item.frequency,
    startDate: item.startDate,
    endDate: item.endDate,
    day1: item.day1,
    day2: item.day2,
  };
}

/** Día calendario (Mazatlán) de un instante. */
function dateInAppZone(at: Date): IsoDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE }).format(at);
}

async function getOwnedItem(db: DbOrTx, actor: Actor, id: string) {
  assertUuid(id, "No encontramos ese pago o ingreso.");
  const [row] = await db
    .select()
    .from(scheduledItems)
    .where(and(eq(scheduledItems.id, id), eq(scheduledItems.userId, actor.id)))
    .limit(1);
  if (!row) throw new AuthzError("No encontramos ese pago o ingreso.");
  return row;
}

async function validateRefs(db: DbOrTx, actor: Actor, input: ScheduledFormInput, allowArchivedAccount?: string) {
  const [acc] = await db
    .select({ id: accounts.id, kind: accounts.kind, archivedAt: accounts.archivedAt })
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, actor.id)))
    .limit(1);
  if (!acc) throw new AuthzError("No encontramos esa cuenta.");
  if (acc.archivedAt && acc.id !== allowArchivedAccount) throw new AuthzError("Esa cuenta está archivada. Elige otra.");
  if (input.kind === "ingreso" && (acc.kind === "credito" || acc.kind === "prestamo")) {
    throw new AuthzError("Un ingreso no puede entrar a una tarjeta de crédito. Elige efectivo o débito.");
  }
  await getOwnedCategory(db, actor, input.categoryId, input.kind === "ingreso" ? "ingreso" : "gasto");
}

/** Campos de calendario a guardar según la frecuencia. */
function scheduleFields(input: ScheduledFormInput, today: IsoDate) {
  // Mensual/quincenal empiezan el 1° del mes actual para que cuenten las fechas de este mes.
  const startDate = input.nextDate ?? `${monthOf(today)}-01`;
  return { frequency: input.frequency, startDate, day1: input.day1, day2: input.day2 };
}

export async function createScheduled(db: DbOrTx, actor: Actor, input: ScheduledFormInput, today = todayIso()) {
  await validateRefs(db, actor, input);
  const [row] = await db
    .insert(scheduledItems)
    .values({
      userId: actor.id,
      kind: input.kind,
      name: input.name,
      amount: input.amount,
      amountIsEstimate: input.amountIsEstimate,
      accountId: input.accountId,
      categoryId: input.categoryId,
      autoRegister: input.autoRegister,
      ...scheduleFields(input, today),
    })
    .returning();
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "scheduled",
    entityId: row.id,
    action: "crear",
    after: row,
  });
  return row;
}

export async function updateScheduled(
  db: DbOrTx,
  actor: Actor,
  id: string,
  input: ScheduledFormInput,
  today = todayIso(),
) {
  const before = await getOwnedItem(db, actor, id);
  if (input.kind !== before.kind) throw new AuthzError("No se puede cambiar de ingreso a pago.");
  await validateRefs(db, actor, input, before.accountId);
  const sameSchedule =
    input.frequency === before.frequency &&
    input.day1 === before.day1 &&
    input.day2 === before.day2 &&
    (input.nextDate == null || isOccurrence(scheduleOf(before), input.nextDate));
  const [after] = await db
    .update(scheduledItems)
    .set({
      name: input.name,
      amount: input.amount,
      amountIsEstimate: input.amountIsEstimate,
      accountId: input.accountId,
      categoryId: input.categoryId,
      autoRegister: input.autoRegister,
      // Si no cambió el calendario se conserva la fecha de inicio original.
      ...(sameSchedule ? {} : scheduleFields(input, today)),
      updatedAt: new Date(),
    })
    .where(and(eq(scheduledItems.id, id), eq(scheduledItems.userId, actor.id)))
    .returning();
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "scheduled",
    entityId: id,
    action: "editar",
    before,
    after,
  });
  return after;
}

export async function setScheduledArchived(db: DbOrTx, actor: Actor, id: string, archived: boolean) {
  await getOwnedItem(db, actor, id);
  await db
    .update(scheduledItems)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(scheduledItems.id, id), eq(scheduledItems.userId, actor.id)));
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "scheduled",
    entityId: id,
    action: archived ? "borrar" : "restaurar",
  });
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export type ScheduledRow = Item & {
  categoryName: string | null;
  categoryIcon: string | null;
  accountName: string;
  nextDate: IsoDate | null;
};

export async function listScheduled(
  db: DbOrTx,
  actor: Actor,
  kind: ScheduleKind,
  opts: { includeArchived?: boolean; today?: IsoDate } = {},
): Promise<ScheduledRow[]> {
  const today = opts.today ?? todayIso();
  const rows = await db
    .select({ item: scheduledItems, categoryName: categories.name, categoryIcon: categories.icon, accountName: accounts.name })
    .from(scheduledItems)
    .innerJoin(accounts, eq(accounts.id, scheduledItems.accountId))
    .leftJoin(categories, eq(categories.id, scheduledItems.categoryId))
    .where(
      and(
        eq(scheduledItems.userId, actor.id),
        eq(scheduledItems.kind, kind),
        opts.includeArchived ? undefined : isNull(scheduledItems.archivedAt),
      ),
    )
    .orderBy(asc(scheduledItems.name));
  return rows
    .map((r) => ({
      ...r.item,
      categoryName: r.categoryName,
      categoryIcon: r.categoryIcon,
      accountName: r.accountName,
      nextDate: nextOccurrence(scheduleOf(r.item), today),
    }))
    .sort((a, b) => (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999"));
}

export async function getScheduled(db: DbOrTx, actor: Actor, id: string) {
  return getOwnedItem(db, actor, id);
}

export type DueStatus = "pendiente" | "confirmado" | "omitido";

export type DueItem = {
  itemId: string;
  kind: ScheduleKind;
  name: string;
  dueDate: IsoDate;
  /** Monto programado (o estimado). */
  amount: Cents;
  amountIsEstimate: boolean;
  status: DueStatus;
  /** Monto real si ya se confirmó. */
  actualAmount: Cents | null;
  transactionId: string | null;
  accountId: string;
  accountName: string;
  categoryIcon: string | null;
  autoRegister: boolean;
  /** Cuándo se confirmó o saltó (null si sigue pendiente). */
  actedAt: Date | null;
};

/** Todas las fechas de mis programados entre `from` y `to`, con su estado. */
export async function listDue(db: DbOrTx, actor: Actor, from: IsoDate, to: IsoDate): Promise<DueItem[]> {
  const items = await db
    .select({ item: scheduledItems, categoryIcon: categories.icon, accountName: accounts.name })
    .from(scheduledItems)
    .innerJoin(accounts, eq(accounts.id, scheduledItems.accountId))
    .leftJoin(categories, eq(categories.id, scheduledItems.categoryId))
    .where(and(eq(scheduledItems.userId, actor.id), isNull(scheduledItems.archivedAt)));
  if (items.length === 0) return [];

  const occ = await db
    .select({
      itemId: scheduledOccurrences.itemId,
      dueDate: scheduledOccurrences.dueDate,
      status: scheduledOccurrences.status,
      transactionId: scheduledOccurrences.transactionId,
      actedAt: scheduledOccurrences.createdAt,
      txAmount: transactions.amount,
      txDeletedAt: transactions.deletedAt,
    })
    .from(scheduledOccurrences)
    .leftJoin(transactions, eq(transactions.id, scheduledOccurrences.transactionId))
    .where(
      and(
        eq(scheduledOccurrences.userId, actor.id),
        inArray(
          scheduledOccurrences.itemId,
          items.map((i) => i.item.id),
        ),
        gte(scheduledOccurrences.dueDate, from),
        lte(scheduledOccurrences.dueDate, to),
      ),
    );
  const byKey = new Map(occ.map((o) => [`${o.itemId}|${o.dueDate}`, o]));

  const out: DueItem[] = [];
  for (const { item, categoryIcon, accountName } of items) {
    for (const dueDate of occurrences(scheduleOf(item), from, to)) {
      const o = byKey.get(`${item.id}|${dueDate}`);
      let status: DueStatus = "pendiente";
      if (o?.status === "omitido") status = "omitido";
      else if (o?.status === "confirmado" && o.transactionId && !o.txDeletedAt) status = "confirmado";
      out.push({
        itemId: item.id,
        kind: item.kind,
        name: item.name,
        dueDate,
        amount: item.amount,
        amountIsEstimate: item.amountIsEstimate,
        status,
        actualAmount: status === "confirmado" ? (o?.txAmount ?? null) : null,
        transactionId: status === "confirmado" ? (o?.transactionId ?? null) : null,
        accountId: item.accountId,
        accountName,
        categoryIcon,
        autoRegister: item.autoRegister,
        actedAt: status === "pendiente" ? null : (o?.actedAt ?? null),
      });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
}

/** Pendientes vencidos (hasta 45 días atrás) + próximos `days` días. */
export async function listUpcoming(db: DbOrTx, actor: Actor, days: number, today = todayIso()) {
  const all = await listDue(db, actor, addDays(today, -LOOKBACK_DAYS), addDays(today, days));
  // Lo confirmado/saltado HOY se sigue mostrando (con su botón Deshacer) el resto del día.
  const actedToday = (d: DueItem) => d.actedAt != null && dateInAppZone(d.actedAt) === today;
  return {
    overdue: all.filter((d) => d.dueDate < today && (d.status === "pendiente" || actedToday(d))),
    upcoming: all.filter((d) => d.dueDate >= today),
  };
}

// ---------------------------------------------------------------------------
// Confirmar / saltar / deshacer una fecha
// ---------------------------------------------------------------------------

async function occurrenceRow(db: DbOrTx, itemId: string, dueDate: IsoDate) {
  const [row] = await db
    .select({
      id: scheduledOccurrences.id,
      status: scheduledOccurrences.status,
      transactionId: scheduledOccurrences.transactionId,
      txDeletedAt: transactions.deletedAt,
    })
    .from(scheduledOccurrences)
    .leftJoin(transactions, eq(transactions.id, scheduledOccurrences.transactionId))
    .where(and(eq(scheduledOccurrences.itemId, itemId), eq(scheduledOccurrences.dueDate, dueDate)))
    .limit(1);
  return row ?? null;
}

/**
 * Candado por (programado, fecha) hasta que termine la transacción: evita que un doble toque
 * o dos pestañas registren el mismo pago dos veces.
 */
async function lockOccurrence(db: DbOrTx, itemId: string, dueDate: IsoDate) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`occ:${itemId}:${dueDate}`}))`);
}

function isActiveConfirmation(row: Awaited<ReturnType<typeof occurrenceRow>>) {
  return row?.status === "confirmado" && row.transactionId != null && row.txDeletedAt == null;
}

export type ConfirmInput = {
  /** Monto real (null = el programado). */
  amount?: Cents | null;
  accountId?: string | null;
  /** Fecha del movimiento (por defecto: la fecha programada, o hoy si aún no llega). */
  date?: IsoDate;
};

/** "Ya lo pagué" / "Ya me pagaron": crea el movimiento real y marca la fecha como hecha. */
export async function confirmOccurrence(
  db: DbOrTx,
  actor: Actor,
  itemId: string,
  dueDate: IsoDate,
  input: ConfirmInput = {},
  today = todayIso(),
) {
  const item = await getOwnedItem(db, actor, itemId);
  if (item.archivedAt) throw new AuthzError("Este pago o ingreso ya no está activo.");
  if (!isOccurrence(scheduleOf(item), dueDate)) throw new AuthzError("Esa fecha no corresponde a este pago.");
  await lockOccurrence(db, itemId, dueDate);
  const existing = await occurrenceRow(db, itemId, dueDate);
  if (isActiveConfirmation(existing)) throw new AuthzError("Esa fecha ya estaba registrada.");

  const txInput = {
    amount: input.amount ?? item.amount,
    categoryId: item.categoryId!,
    accountId: input.accountId ?? item.accountId,
    date: input.date ?? (dueDate <= today ? dueDate : today),
    note: item.name,
  };
  const meta = { origin: "recurrente" as const, sourceId: item.id };
  const tx =
    item.kind === "pago"
      ? await createExpense(db, actor, txInput, meta)
      : await createIncome(db, actor, txInput, meta);

  await db
    .insert(scheduledOccurrences)
    .values({ itemId, userId: actor.id, dueDate, status: "confirmado", transactionId: tx.id })
    .onConflictDoUpdate({
      target: [scheduledOccurrences.itemId, scheduledOccurrences.dueDate],
      set: { status: "confirmado", transactionId: tx.id, createdAt: new Date() },
    });
  return tx;
}

/** "Esta vez no aplica / ya lo había anotado". */
export async function skipOccurrence(db: DbOrTx, actor: Actor, itemId: string, dueDate: IsoDate) {
  const item = await getOwnedItem(db, actor, itemId);
  if (!isOccurrence(scheduleOf(item), dueDate)) throw new AuthzError("Esa fecha no corresponde a este pago.");
  await lockOccurrence(db, itemId, dueDate);
  const existing = await occurrenceRow(db, itemId, dueDate);
  if (isActiveConfirmation(existing)) {
    throw new AuthzError("Esa fecha ya está registrada. Si fue un error, usa Deshacer.");
  }
  await db
    .insert(scheduledOccurrences)
    .values({ itemId, userId: actor.id, dueDate, status: "omitido" })
    .onConflictDoUpdate({
      target: [scheduledOccurrences.itemId, scheduledOccurrences.dueDate],
      set: { status: "omitido", transactionId: null, createdAt: new Date() },
    });
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "scheduled",
    entityId: itemId,
    action: "editar",
    after: { omitido: dueDate },
  });
}

/** Deshacer: la fecha vuelve a quedar pendiente y el movimiento (si hubo) se borra. */
export async function undoOccurrence(db: DbOrTx, actor: Actor, itemId: string, dueDate: IsoDate) {
  await getOwnedItem(db, actor, itemId);
  const existing = await occurrenceRow(db, itemId, dueDate);
  if (!existing) return;
  if (existing.transactionId && !existing.txDeletedAt) {
    await deleteTransaction(db, actor, existing.transactionId);
  }
  await db.delete(scheduledOccurrences).where(eq(scheduledOccurrences.id, existing.id));
}

/**
 * Registra solos los domiciliados / depósitos automáticos cuya fecha ya llegó.
 * Nunca genera fechas anteriores al alta, ni más de 45 días atrás, ni fechas ya tocadas
 * (si la persona borró uno automático, no se vuelve a crear).
 */
export async function syncAutoOccurrences(db: DbOrTx, actor: Actor, today = todayIso()) {
  const items = await db
    .select()
    .from(scheduledItems)
    .where(
      and(
        eq(scheduledItems.userId, actor.id),
        eq(scheduledItems.autoRegister, true),
        isNull(scheduledItems.archivedAt),
      ),
    );
  let created = 0;
  for (const item of items) {
    // Los automáticos no se generan antes del día en que se dieron de alta.
    const created0 = dateInAppZone(item.createdAt);
    const floor = addDays(today, -LOOKBACK_DAYS);
    const from = created0 > floor ? created0 : floor;
    const dates = occurrences(scheduleOf(item), from, today);
    if (dates.length === 0) continue;
    const done = await db
      .select({ dueDate: scheduledOccurrences.dueDate })
      .from(scheduledOccurrences)
      .where(and(eq(scheduledOccurrences.itemId, item.id), inArray(scheduledOccurrences.dueDate, dates)));
    const doneSet = new Set(done.map((d) => d.dueDate));
    for (const dueDate of dates) {
      if (doneSet.has(dueDate)) continue;
      try {
        // Cada fecha en su propia transacción (todo o nada).
        await db.transaction((t) => confirmOccurrence(t, actor, item.id, dueDate, { date: dueDate }, today));
        created++;
      } catch (e) {
        // Cuenta archivada u otro problema: se deja pendiente para que la persona decida.
        if (!(e instanceof AuthzError)) throw e;
      }
    }
  }
  return created;
}
