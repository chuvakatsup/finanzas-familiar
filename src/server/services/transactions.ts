import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbOrTx } from "@/server/db";
import { accounts, categories, scheduledOccurrences, transactions } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { type Actor, AuthzError } from "@/server/authz";
import { assertUuid } from "@/server/ids";
import type { AccountKind } from "@/domain/accounts";
import type { IsoDate } from "@/domain/dates";
import { type Cents, parseMoney } from "@/domain/money";
import { type TxKind, transferKind } from "@/domain/transactions";
import { getOwnedCategory } from "./categories";

type Tx = typeof transactions.$inferSelect;

/** Comprueba que las cuentas sean del actor. `allowArchived` = ids que ya tenía el movimiento. */
async function ownedAccounts(db: DbOrTx, actor: Actor, ids: string[], allowArchived: string[] = []) {
  const unique = [...new Set(ids)];
  const rows = await db
    .select({ id: accounts.id, kind: accounts.kind, archivedAt: accounts.archivedAt })
    .from(accounts)
    .where(and(eq(accounts.userId, actor.id), inArray(accounts.id, unique)));
  const map = new Map(rows.map((r) => [r.id, r]));
  for (const id of unique) {
    const row = map.get(id);
    if (!row) throw new AuthzError("No encontramos esa cuenta.");
    if (row.archivedAt && !allowArchived.includes(id)) {
      throw new AuthzError("Esa cuenta está archivada. Elige otra.");
    }
  }
  return map as Map<string, { id: string; kind: AccountKind; archivedAt: Date | null }>;
}

async function logTx(db: DbOrTx, actor: Actor, action: "crear" | "editar" | "borrar" | "restaurar", tx: Tx, before?: Tx) {
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "transaction",
    entityId: tx.id,
    action,
    before,
    after: tx,
  });
}

export type CategorizedInput = {
  amount: Cents;
  categoryId: string;
  accountId: string;
  date: IsoDate;
  note: string | null;
};

/** Quién generó el movimiento (vacío = lo capturó la persona). */
export type TxMeta = { origin: Tx["origin"]; sourceId: string | null };
const MANUAL: TxMeta = { origin: "manual", sourceId: null };

export type TransferInput = {
  amount: Cents;
  fromAccountId: string;
  toAccountId: string;
  date: IsoDate;
  note: string | null;
};

/** Gasto: sale dinero de la cuenta (con tarjeta de crédito, aumenta la deuda). */
export async function createExpense(db: DbOrTx, actor: Actor, input: CategorizedInput, meta: TxMeta = MANUAL) {
  await ownedAccounts(db, actor, [input.accountId]);
  await getOwnedCategory(db, actor, input.categoryId, "gasto");
  const [tx] = await db
    .insert(transactions)
    .values({
      userId: actor.id,
      kind: "gasto",
      amount: input.amount,
      date: input.date,
      fromAccountId: input.accountId,
      categoryId: input.categoryId,
      note: input.note,
      ...meta,
    })
    .returning();
  await logTx(db, actor, "crear", tx);
  return tx;
}

/** Ingreso extra: entra dinero a la cuenta. */
export async function createIncome(db: DbOrTx, actor: Actor, input: CategorizedInput, meta: TxMeta = MANUAL) {
  const owned = await ownedAccounts(db, actor, [input.accountId]);
  if (owned.get(input.accountId)!.kind === "credito") {
    throw new AuthzError("Un ingreso no puede entrar a una tarjeta de crédito. Elige efectivo o débito.");
  }
  await getOwnedCategory(db, actor, input.categoryId, "ingreso");
  const [tx] = await db
    .insert(transactions)
    .values({
      userId: actor.id,
      kind: "ingreso",
      amount: input.amount,
      date: input.date,
      toAccountId: input.accountId,
      categoryId: input.categoryId,
      note: input.note,
      ...meta,
    })
    .returning();
  await logTx(db, actor, "crear", tx);
  return tx;
}

/** Pasar dinero entre cuentas propias. Si el destino es tarjeta, es "pago de tarjeta" (no gasto). */
export async function createTransfer(db: DbOrTx, actor: Actor, input: TransferInput) {
  if (input.fromAccountId === input.toAccountId) throw new AuthzError("Elige dos cuentas diferentes.");
  const owned = await ownedAccounts(db, actor, [input.fromAccountId, input.toAccountId]);
  const [tx] = await db
    .insert(transactions)
    .values({
      userId: actor.id,
      kind: transferKind(owned.get(input.toAccountId)!.kind),
      amount: input.amount,
      date: input.date,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      note: input.note,
    })
    .returning();
  await logTx(db, actor, "crear", tx);
  return tx;
}

async function getOwnedTx(db: DbOrTx, actor: Actor, id: string) {
  assertUuid(id, "No encontramos ese movimiento.");
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, actor.id)))
    .limit(1);
  if (!row) throw new AuthzError("No encontramos ese movimiento.");
  return row;
}

const EDITABLE_TRANSFER_KINDS: TxKind[] = ["transferencia", "pago_tarjeta", "pago_prestamo"];

/** Editar un movimiento manual. Respeta su tipo (un gasto sigue siendo gasto). */
export async function updateTransaction(
  db: DbOrTx,
  actor: Actor,
  id: string,
  input: CategorizedInput | TransferInput,
) {
  const before = await getOwnedTx(db, actor, id);
  if (before.deletedAt) throw new AuthzError("Ese movimiento fue borrado.");
  // Los confirmados desde un pago/ingreso programado sí se pueden corregir (monto real, fecha, etc.).
  if (before.origin !== "manual" && before.origin !== "recurrente") {
    throw new AuthzError("Este movimiento se generó automáticamente; cámbialo desde donde se creó.");
  }
  const previousAccounts = [before.fromAccountId, before.toAccountId].filter((x): x is string => !!x);
  let patch: Partial<Tx>;

  if (before.kind === "gasto" || before.kind === "ingreso") {
    if (!("categoryId" in input)) throw new AuthzError("Faltan datos.");
    const owned = await ownedAccounts(db, actor, [input.accountId], previousAccounts);
    if (before.kind === "ingreso" && owned.get(input.accountId)!.kind === "credito") {
      throw new AuthzError("Un ingreso no puede entrar a una tarjeta de crédito.");
    }
    await getOwnedCategory(db, actor, input.categoryId, before.kind);
    patch = {
      amount: input.amount,
      date: input.date,
      note: input.note,
      categoryId: input.categoryId,
      fromAccountId: before.kind === "gasto" ? input.accountId : null,
      toAccountId: before.kind === "ingreso" ? input.accountId : null,
    };
  } else if (EDITABLE_TRANSFER_KINDS.includes(before.kind)) {
    if (!("fromAccountId" in input)) throw new AuthzError("Faltan datos.");
    if (input.fromAccountId === input.toAccountId) throw new AuthzError("Elige dos cuentas diferentes.");
    const owned = await ownedAccounts(db, actor, [input.fromAccountId, input.toAccountId], previousAccounts);
    patch = {
      kind: transferKind(owned.get(input.toAccountId)!.kind),
      amount: input.amount,
      date: input.date,
      note: input.note,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
    };
  } else {
    throw new AuthzError("Este tipo de movimiento no se puede editar aquí.");
  }

  const [after] = await db
    .update(transactions)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(transactions.id, id), eq(transactions.userId, actor.id)))
    .returning();
  await logTx(db, actor, "editar", after, before);
  return after;
}

/** Movimientos que pertenecen a un préstamo o compra a meses: se cambian desde ahí, no sueltos. */
function assertNotOwnedBySource(tx: Tx, opts: { fromSource?: boolean }) {
  if (!opts.fromSource && (tx.origin === "prestamo" || tx.origin === "msi")) {
    throw new AuthzError("Este movimiento es parte de un préstamo o compra a meses. Cámbialo desde ahí.");
  }
}

/** Borrado suave: se puede deshacer. */
export async function deleteTransaction(db: DbOrTx, actor: Actor, id: string, opts: { fromSource?: boolean } = {}) {
  const before = await getOwnedTx(db, actor, id);
  assertNotOwnedBySource(before, opts);
  if (before.deletedAt) return before;
  const [after] = await db
    .update(transactions)
    .set({ deletedAt: new Date() })
    .where(and(eq(transactions.id, id), eq(transactions.userId, actor.id)))
    .returning();
  await logTx(db, actor, "borrar", after, before);
  return after;
}

export async function restoreTransaction(db: DbOrTx, actor: Actor, id: string, opts: { fromSource?: boolean } = {}) {
  const before = await getOwnedTx(db, actor, id);
  assertNotOwnedBySource(before, opts);
  if (!before.deletedAt) return before;
  if (before.origin === "recurrente") {
    // Si esa fecha ya se volvió a confirmar con otro movimiento, recuperar éste lo contaría doble.
    const [occ] = await db
      .select({ id: scheduledOccurrences.id })
      .from(scheduledOccurrences)
      .where(and(eq(scheduledOccurrences.transactionId, id), eq(scheduledOccurrences.userId, actor.id)))
      .limit(1);
    if (!occ) throw new AuthzError("Ese pago ya se volvió a registrar, así que no se puede recuperar este.");
  }
  const [after] = await db
    .update(transactions)
    .set({ deletedAt: null })
    .where(and(eq(transactions.id, id), eq(transactions.userId, actor.id)))
    .returning();
  await logTx(db, actor, "restaurar", after, before);
  return after;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

const fromAcc = alias(accounts, "from_acc");
const toAcc = alias(accounts, "to_acc");

const rowFields = {
  id: transactions.id,
  kind: transactions.kind,
  amount: transactions.amount,
  date: transactions.date,
  note: transactions.note,
  origin: transactions.origin,
  deletedAt: transactions.deletedAt,
  categoryId: transactions.categoryId,
  categoryName: categories.name,
  categoryIcon: categories.icon,
  fromAccountId: transactions.fromAccountId,
  fromAccountName: fromAcc.name,
  toAccountId: transactions.toAccountId,
  toAccountName: toAcc.name,
};

export type TxRow = {
  id: string;
  kind: TxKind;
  amount: Cents;
  date: IsoDate;
  note: string | null;
  origin: Tx["origin"];
  deletedAt: Date | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  fromAccountId: string | null;
  fromAccountName: string | null;
  toAccountId: string | null;
  toAccountName: string | null;
};

function baseQuery(db: DbOrTx) {
  return db
    .select(rowFields)
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(fromAcc, eq(fromAcc.id, transactions.fromAccountId))
    .leftJoin(toAcc, eq(toAcc.id, transactions.toAccountId));
}

export type TxFilters = {
  from?: IsoDate;
  to?: IsoDate;
  accountId?: string;
  categoryId?: string;
  q?: string;
  limit?: number;
};

export async function listTransactions(db: DbOrTx, actor: Actor, f: TxFilters = {}): Promise<TxRow[]> {
  // Si lo buscado parece un monto ("150" o "150.50"), también se busca por cantidad exacta.
  const searchCents = f.q ? parseMoney(f.q) : null;
  const search = f.q ? `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : undefined;
  return baseQuery(db)
    .where(
      and(
        eq(transactions.userId, actor.id),
        isNull(transactions.deletedAt),
        f.from ? gte(transactions.date, f.from) : undefined,
        f.to ? lte(transactions.date, f.to) : undefined,
        f.accountId
          ? or(eq(transactions.fromAccountId, f.accountId), eq(transactions.toAccountId, f.accountId))
          : undefined,
        f.categoryId ? eq(transactions.categoryId, f.categoryId) : undefined,
        search
          ? or(
              ilike(transactions.note, search),
              ilike(categories.name, search),
              searchCents != null ? eq(transactions.amount, searchCents) : undefined,
            )
          : undefined,
      ),
    )
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(f.limit ?? 500);
}

export async function getTransaction(db: DbOrTx, actor: Actor, id: string): Promise<TxRow> {
  assertUuid(id, "No encontramos ese movimiento.");
  const [row] = await baseQuery(db)
    .where(and(eq(transactions.id, id), eq(transactions.userId, actor.id)))
    .limit(1);
  if (!row) throw new AuthzError("No encontramos ese movimiento.");
  return row;
}

/** Cuenta usada en el último movimiento de ese tipo (para proponerla por defecto). */
export async function lastUsedAccountId(db: DbOrTx, actor: Actor, kind: "gasto" | "ingreso") {
  const col = kind === "gasto" ? transactions.fromAccountId : transactions.toAccountId;
  const [row] = await db
    .select({ accountId: col })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, col))
    .where(
      and(
        eq(transactions.userId, actor.id),
        eq(transactions.kind, kind),
        isNull(transactions.deletedAt),
        isNull(accounts.archivedAt),
        isNotNull(col),
      ),
    )
    .orderBy(desc(transactions.createdAt))
    .limit(1);
  return row?.accountId ?? null;
}
