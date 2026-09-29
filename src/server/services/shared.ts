import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbOrTx } from "@/server/db";
import { accounts, categories, sharedDebts, transactions, users } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { type Actor, AuthzError } from "@/server/authz";
import { assertUuid } from "@/server/ids";
import { APP_TIME_ZONE, type IsoDate, todayIso } from "@/domain/dates";
import type { Cents } from "@/domain/money";
import { type SplitMode, type SplitPart, computeShares } from "@/domain/shared";
import { ensureCategory } from "./categories";
import { ownMoneyAccount } from "./support";
import { deleteTransaction } from "./transactions";

type Debt = typeof sharedDebts.$inferSelect;
export type SharedStatus = Debt["status"];
export type ShareInput = { mode: SplitMode; parts: SplitPart[] };

async function logShared(db: DbOrTx, actor: Actor, id: string, action: Parameters<typeof audit>[1]["action"], after?: unknown) {
  await audit(db, { householdId: actor.householdId, actorUserId: actor.id, entity: "shared", entityId: id, action, after });
}

async function lock(db: DbOrTx, id: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`shared:${id}`}))`);
}

async function userName(db: DbOrTx, id: string) {
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, id)).limit(1);
  return u?.name ?? "";
}

/** Gasto propio que se puede repartir: manual, no borrado. */
async function ownExpense(db: DbOrTx, actor: Actor, txId: string) {
  assertUuid(txId, "No encontramos ese gasto.");
  const [row] = await db
    .select({ tx: transactions, categoryName: categories.name })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.id, txId), eq(transactions.userId, actor.id)))
    .limit(1);
  if (!row) throw new AuthzError("No encontramos ese gasto.");
  if (row.tx.deletedAt) throw new AuthzError("Ese gasto fue borrado.");
  if (row.tx.kind !== "gasto" || row.tx.origin !== "manual") {
    throw new AuthzError("Solo se pueden compartir gastos que registraste tú.");
  }
  return row;
}

/**
 * Reparte un gasto propio con otras personas de MI familia. Queda "pendiente" para cada una;
 * a mí solo me cuenta lo que no repartí. Un gasto se reparte una sola vez (para cambiarlo: quitar y repartir de nuevo).
 */
export async function shareExpense(db: DbOrTx, actor: Actor, txId: string, input: ShareInput) {
  const { tx, categoryName } = await ownExpense(db, actor, txId);
  await lock(db, tx.id);
  const [already] = await db.select({ id: sharedDebts.id }).from(sharedDebts).where(eq(sharedDebts.sourceTxId, tx.id)).limit(1);
  if (already) throw new AuthzError("Este gasto ya está compartido.");

  const ids = input.parts.map((p) => p.userId);
  for (const id of ids) assertUuid(id, "Elige con quién lo compartes.");
  if (ids.includes(actor.id)) throw new AuthzError("Tu parte es lo que no repartes; no te agregues a ti.");
  const family = ids.length
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, ids), eq(users.householdId, actor.householdId), eq(users.active, true)))
    : [];
  if (family.length !== new Set(ids).size) throw new AuthzError("No encontramos a esa persona en tu familia.");

  const split = computeShares(tx.amount, input.mode, input.parts);
  if (!split.ok) throw new AuthzError(split.error);
  const concept = tx.note?.trim() || categoryName || "Gasto";
  const rows = await db
    .insert(sharedDebts)
    .values(
      split.shares.map((s) => ({
        householdId: actor.householdId,
        ownerId: actor.id,
        debtorId: s.userId,
        sourceTxId: tx.id,
        amount: s.amount,
        percentBp: s.percentBp,
        date: tx.date,
        concept,
      })),
    )
    .returning();
  for (const r of rows) await logShared(db, actor, r.id, "crear", r);
  return rows;
}

/** Quitar el reparto: solo si nadie ha pagado todavía. El gasto vuelve a contar completo para mí. */
export async function unshareExpense(db: DbOrTx, actor: Actor, txId: string) {
  assertUuid(txId, "No encontramos ese gasto.");
  await lock(db, txId);
  const rows = await db
    .select()
    .from(sharedDebts)
    .where(and(eq(sharedDebts.sourceTxId, txId), eq(sharedDebts.ownerId, actor.id)));
  if (!rows.length) return;
  if (rows.some((r) => r.status === "pagado" || r.status === "recibido")) {
    throw new AuthzError("Alguien ya te pagó su parte. Primero deshaz ese pago.");
  }
  await db.delete(sharedDebts).where(and(eq(sharedDebts.sourceTxId, txId), eq(sharedDebts.ownerId, actor.id)));
  for (const r of rows) await logShared(db, actor, r.id, "borrar", r);
}

/** Una parte en la que participo (como dueño o como quien debe), con su gasto de origen vivo. */
async function getVisible(db: DbOrTx, actor: Actor, id: string) {
  assertUuid(id, "No encontramos ese gasto compartido.");
  const [row] = await db
    .select({ d: sharedDebts })
    .from(sharedDebts)
    .innerJoin(transactions, eq(transactions.id, sharedDebts.sourceTxId))
    .where(
      and(
        eq(sharedDebts.id, id),
        isNull(transactions.deletedAt),
        or(eq(sharedDebts.ownerId, actor.id), eq(sharedDebts.debtorId, actor.id)),
      ),
    )
    .limit(1);
  if (!row) throw new AuthzError("No encontramos ese gasto compartido.");
  return row.d;
}

/** Relee la parte con candado (para cambiar su estado sin carreras). */
async function lockFresh(db: DbOrTx, actor: Actor, id: string, role: "owner" | "debtor", message: string) {
  const d = await getVisible(db, actor, id);
  if ((role === "owner" ? d.ownerId : d.debtorId) !== actor.id) throw new AuthzError(message);
  await lock(db, d.id);
  const [fresh] = await db.select().from(sharedDebts).where(eq(sharedDebts.id, d.id));
  return fresh;
}

/** Quien debe: "Ya te pagué". Sale de su cuenta como gasto "Gastos compartidos". */
export async function markSharedPaid(db: DbOrTx, actor: Actor, id: string, input: { fromAccountId: string }, today = todayIso()) {
  const d = await lockFresh(db, actor, id, "debtor", "Solo quien debe la parte puede marcarla como pagada.");
  if (d.status !== "pendiente") throw new AuthzError("Esta parte ya se pagó o se rechazó.");
  const from = await ownMoneyAccount(db, actor, input.fromAccountId);
  const categoryId = await ensureCategory(db, actor.id, "gasto", "Gastos compartidos", "👥");
  const [tx] = await db
    .insert(transactions)
    .values({
      userId: actor.id,
      kind: "gasto",
      amount: d.amount,
      date: today,
      fromAccountId: from.id,
      categoryId,
      note: `Tu parte de ${d.concept} (a ${await userName(db, d.ownerId)})`,
      origin: "compartido",
      sourceId: d.id,
    })
    .returning({ id: transactions.id });
  await db
    .update(sharedDebts)
    .set({ status: "pagado", paidTxId: tx.id, paidAt: new Date(), updatedAt: new Date() })
    .where(eq(sharedDebts.id, d.id));
  await logShared(db, actor, d.id, "editar", { pagado: true });
  return { ...d, status: "pagado" as const, paidTxId: tx.id };
}

/** Quien debe: deshacer "Ya te pagué" (solo mientras el dueño no lo confirme). */
export async function undoSharedPaid(db: DbOrTx, actor: Actor, id: string) {
  const d = await lockFresh(db, actor, id, "debtor", "Solo quien pagó puede deshacerlo.");
  if (d.status === "recibido") throw new AuthzError("Ya se confirmó que llegó. Pide que lo deshagan primero.");
  if (d.status !== "pagado") return;
  if (d.paidTxId) await deleteTransaction(db, actor, d.paidTxId, { fromSource: true });
  await db
    .update(sharedDebts)
    .set({ status: "pendiente", paidTxId: null, paidAt: null, updatedAt: new Date() })
    .where(eq(sharedDebts.id, d.id));
  await logShared(db, actor, d.id, "restaurar", { pagado: false });
}

/**
 * Dueño: "Sí, me llegó". Entra como reembolso (no es ingreso) a la cuenta que elija;
 * si elige la tarjeta, baja su deuda directo.
 */
export async function confirmSharedReceived(db: DbOrTx, actor: Actor, id: string, input: { accountId: string }, today = todayIso()) {
  const d = await lockFresh(db, actor, id, "owner", "Solo a quien le deben puede confirmar que le llegó.");
  if (d.status !== "pagado") throw new AuthzError("Todavía no te marcan esta parte como pagada.");
  assertUuid(input.accountId, "Elige a dónde te llegó.");
  const [into] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, actor.id)))
    .limit(1);
  if (!into || into.archivedAt || into.kind === "prestamo") throw new AuthzError("Elige una de tus cuentas o tarjetas.");
  const [tx] = await db
    .insert(transactions)
    .values({
      userId: actor.id,
      kind: "reembolso",
      amount: d.amount,
      date: today,
      toAccountId: into.id,
      note: `Parte de ${await userName(db, d.debtorId)}: ${d.concept}`,
      origin: "compartido",
      sourceId: d.id,
    })
    .returning({ id: transactions.id });
  await db
    .update(sharedDebts)
    .set({ status: "recibido", receivedTxId: tx.id, receivedAt: new Date(), updatedAt: new Date() })
    .where(eq(sharedDebts.id, d.id));
  await logShared(db, actor, d.id, "editar", { recibido: true, accountId: into.id });
}

export async function undoSharedReceived(db: DbOrTx, actor: Actor, id: string) {
  const d = await lockFresh(db, actor, id, "owner", "Solo a quien le deben puede deshacerlo.");
  if (d.status !== "recibido") return;
  if (d.receivedTxId) await deleteTransaction(db, actor, d.receivedTxId, { fromSource: true });
  await db
    .update(sharedDebts)
    .set({ status: "pagado", receivedTxId: null, receivedAt: null, updatedAt: new Date() })
    .where(eq(sharedDebts.id, d.id));
  await logShared(db, actor, d.id, "restaurar", { recibido: false });
}

/** Quien debe: "Esto no es mío". La parte vuelve a contar completa para el dueño, a quien se le avisa. */
export async function rejectShared(db: DbOrTx, actor: Actor, id: string) {
  const d = await lockFresh(db, actor, id, "debtor", "Solo a quien le asignaron la parte puede rechazarla.");
  if (d.status !== "pendiente") throw new AuthzError("Esta parte ya se pagó; primero deshaz el pago.");
  await db
    .update(sharedDebts)
    .set({ status: "rechazado", rejectedAt: new Date(), dismissedAt: null, updatedAt: new Date() })
    .where(eq(sharedDebts.id, d.id));
  await logShared(db, actor, d.id, "editar", { rechazado: true });
}

export async function undoRejectShared(db: DbOrTx, actor: Actor, id: string) {
  const d = await lockFresh(db, actor, id, "debtor", "Solo quien la rechazó puede deshacerlo.");
  if (d.status !== "rechazado") return;
  await db
    .update(sharedDebts)
    .set({ status: "pendiente", rejectedAt: null, dismissedAt: null, updatedAt: new Date() })
    .where(eq(sharedDebts.id, d.id));
  await logShared(db, actor, d.id, "restaurar", { rechazado: false });
}

/** Dueño: "Entendido" (ya vio que no le correspondía; deja de mostrarse el aviso). */
export async function dismissRejectedShared(db: DbOrTx, actor: Actor, id: string) {
  const d = await lockFresh(db, actor, id, "owner", "No encontramos ese gasto compartido.");
  if (d.status !== "rechazado") return;
  await db.update(sharedDebts).set({ dismissedAt: new Date() }).where(eq(sharedDebts.id, d.id));
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

const ownerU = alias(users, "owner_u");
const debtorU = alias(users, "debtor_u");

/** Lo que ve cada quien de una parte. Quien debe NUNCA ve la cuenta o tarjeta del dueño. */
export type SharedView = {
  id: string;
  sourceTxId: string | null;
  amount: Cents;
  percentBp: number | null;
  date: IsoDate;
  concept: string;
  status: SharedStatus;
  paidAt: Date | null;
  receivedAt: Date | null;
  rejectedAt: Date | null;
  dismissedAt: Date | null;
  ownerName: string;
  debtorName: string;
  iAmOwner: boolean;
};

async function listVisible(db: DbOrTx, actor: Actor, where?: ReturnType<typeof and>): Promise<SharedView[]> {
  const rows = await db
    .select({ d: sharedDebts, ownerName: ownerU.name, debtorName: debtorU.name })
    .from(sharedDebts)
    .innerJoin(transactions, eq(transactions.id, sharedDebts.sourceTxId))
    .innerJoin(ownerU, eq(ownerU.id, sharedDebts.ownerId))
    .innerJoin(debtorU, eq(debtorU.id, sharedDebts.debtorId))
    .where(
      and(
        isNull(transactions.deletedAt),
        or(eq(sharedDebts.ownerId, actor.id), eq(sharedDebts.debtorId, actor.id)),
        where,
      ),
    )
    .orderBy(desc(sharedDebts.date), desc(sharedDebts.createdAt))
    .limit(300);
  return rows.map(({ d, ownerName, debtorName }) => {
    const iAmOwner = d.ownerId === actor.id;
    return {
      id: d.id,
      // El id del gasto de origen solo es útil (y visible) para el dueño.
      sourceTxId: iAmOwner ? d.sourceTxId : null,
      amount: d.amount,
      percentBp: d.percentBp,
      date: d.date,
      concept: d.concept,
      status: d.status,
      paidAt: d.paidAt,
      receivedAt: d.receivedAt,
      rejectedAt: d.rejectedAt,
      dismissedAt: d.dismissedAt,
      ownerName,
      debtorName,
      iAmOwner,
    };
  });
}

export function listShared(db: DbOrTx, actor: Actor) {
  return listVisible(db, actor);
}

/** Partes de un gasto mío (para su pantalla de detalle). */
export function sharedForTx(db: DbOrTx, actor: Actor, txId: string) {
  assertUuid(txId, "No encontramos ese gasto.");
  return listVisible(db, actor, and(eq(sharedDebts.sourceTxId, txId), eq(sharedDebts.ownerId, actor.id)));
}

function dateInAppZone(at: Date): IsoDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE }).format(at);
}

/**
 * Bandeja de Inicio.
 * - Si debo: lo pendiente (+ lo que pagué o rechacé HOY, para poder deshacer).
 * - Si me deben: lo que me marcaron como pagado (¿te llegó?), lo que confirmé HOY y los "no es mío" sin ver.
 */
export async function sharedInbox(db: DbOrTx, actor: Actor, today = todayIso()) {
  const all = await listVisible(db, actor, and(ne(sharedDebts.status, "recibido")));
  const receivedToday = await listVisible(
    db,
    actor,
    and(eq(sharedDebts.status, "recibido"), eq(sharedDebts.ownerId, actor.id)),
  );
  const isToday = (d: Date | null) => d != null && dateInAppZone(d) === today;
  return [
    ...all.filter((s) =>
      s.iAmOwner
        ? s.status === "pagado" || (s.status === "rechazado" && s.dismissedAt == null)
        : s.status === "pendiente" || (s.status === "pagado" && isToday(s.paidAt)) || (s.status === "rechazado" && isToday(s.rejectedAt)),
    ),
    ...receivedToday.filter((s) => isToday(s.receivedAt)),
  ];
}

/**
 * Para el balance del mes:
 * - `sharedOut`: por cada gasto mío del mes, cuánto les toca a otros (sin los rechazados) → se descuenta.
 * - `owed`: mis partes pendientes de pagar con fecha en el mes → compromiso.
 */
export async function sharedForMonth(db: DbOrTx, actor: Actor, from: IsoDate, to: IsoDate) {
  const rows = await listVisible(db, actor, and(gte(sharedDebts.date, from), lte(sharedDebts.date, to)));
  const sharedOut = new Map<string, Cents>();
  const owed: { amount: Cents; date: IsoDate; to: string; concept: string }[] = [];
  for (const r of rows) {
    if (r.iAmOwner && r.status !== "rechazado" && r.sourceTxId) {
      sharedOut.set(r.sourceTxId, (sharedOut.get(r.sourceTxId) ?? 0) + r.amount);
    }
    if (!r.iAmOwner && r.status === "pendiente") owed.push({ amount: r.amount, date: r.date, to: r.ownerName, concept: r.concept });
  }
  return { sharedOut, owed };
}

/** Totales para la pantalla de compartidos: cuánto me deben y cuánto debo (sin lo ya saldado ni rechazado). */
export function sharedTotals(views: readonly SharedView[]) {
  let owedToMe = 0;
  let iOwe = 0;
  for (const v of views) {
    if (v.status !== "pendiente" && v.status !== "pagado") continue;
    if (v.iAmOwner) owedToMe += v.amount;
    else if (v.status === "pendiente") iOwe += v.amount;
  }
  return { owedToMe, iOwe };
}
