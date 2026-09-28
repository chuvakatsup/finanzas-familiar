import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { accounts, transactions } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { type Actor, AuthzError } from "@/server/authz";
import { assertUuid } from "@/server/ids";
import { ACCOUNT_KIND_INFO, type AccountKind } from "@/domain/accounts";
import { todayIso } from "@/domain/dates";
import type { Cents } from "@/domain/money";
import type { AccountFormInput } from "@/lib/schemas/finance";

/**
 * Saldo calculado en SQL: inicial + entradas − salidas (sin contar borrados).
 * Ojo: dentro de un select, Drizzle escribe las columnas sin tabla; por eso aquí se califican a mano
 * (si no, "id" dentro de la subconsulta se confundiría con t.id).
 */
const balanceSql = sql<number>`(
  "accounts"."opening_balance"
  + coalesce((select sum(t.amount) from "transactions" t
              where t.to_account_id = "accounts"."id" and t.deleted_at is null), 0)
  - coalesce((select sum(t.amount) from "transactions" t
              where t.from_account_id = "accounts"."id" and t.deleted_at is null), 0)
)::bigint`.mapWith(Number);

const accountFields = {
  id: accounts.id,
  kind: accounts.kind,
  name: accounts.name,
  last4: accounts.last4,
  openingBalance: accounts.openingBalance,
  creditLimit: accounts.creditLimit,
  statementDay: accounts.statementDay,
  paymentDueDay: accounts.paymentDueDay,
  archivedAt: accounts.archivedAt,
  balance: balanceSql,
};

export type AccountWithBalance = {
  id: string;
  kind: AccountKind;
  name: string;
  last4: string | null;
  openingBalance: Cents;
  creditLimit: Cents | null;
  statementDay: number | null;
  paymentDueDay: number | null;
  archivedAt: Date | null;
  balance: Cents;
};

export async function listAccounts(
  db: DbOrTx,
  actor: Actor,
  opts: { includeArchived?: boolean } = {},
): Promise<AccountWithBalance[]> {
  return db
    .select(accountFields)
    .from(accounts)
    .where(and(eq(accounts.userId, actor.id), opts.includeArchived ? undefined : isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt));
}

export async function getAccount(db: DbOrTx, actor: Actor, id: string): Promise<AccountWithBalance> {
  assertUuid(id, "No encontramos esa cuenta.");
  const [row] = await db
    .select(accountFields)
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, actor.id)))
    .limit(1);
  if (!row) throw new AuthzError("No encontramos esa cuenta.");
  return row;
}

/** Lo que la persona escribe como "saldo" → saldo interno (deudas en negativo). */
export function toInternalBalance(kind: AccountKind, typed: Cents): Cents {
  return ACCOUNT_KIND_INFO[kind].isDebt ? -typed : typed;
}

function creditFields(kind: AccountKind, input: Omit<AccountFormInput, "kind" | "balance">) {
  const isCredit = kind === "credito";
  return {
    creditLimit: isCredit ? input.creditLimit : null,
    statementDay: isCredit ? input.statementDay : null,
    paymentDueDay: isCredit ? input.paymentDueDay : null,
    last4: kind === "efectivo" ? null : input.last4,
  };
}

export async function createAccount(db: DbOrTx, actor: Actor, input: AccountFormInput) {
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${accounts.sortOrder}), 0)::int` })
    .from(accounts)
    .where(eq(accounts.userId, actor.id));
  const [row] = await db
    .insert(accounts)
    .values({
      userId: actor.id,
      kind: input.kind,
      name: input.name,
      openingBalance: toInternalBalance(input.kind, input.balance),
      sortOrder: max + 1,
      ...creditFields(input.kind, input),
    })
    .returning();
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "account",
    entityId: row.id,
    action: "crear",
    after: row,
  });
  return row;
}

export async function updateAccount(
  db: DbOrTx,
  actor: Actor,
  id: string,
  input: Omit<AccountFormInput, "kind" | "balance">,
) {
  const before = await getAccount(db, actor, id);
  const [after] = await db
    .update(accounts)
    .set({ name: input.name, ...creditFields(before.kind, input), updatedAt: new Date() })
    .where(and(eq(accounts.id, id), eq(accounts.userId, actor.id)))
    .returning();
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "account",
    entityId: id,
    action: "editar",
    before,
    after,
  });
  return after;
}

/** Archivar en vez de borrar: los movimientos pasados se conservan. */
export async function setAccountArchived(db: DbOrTx, actor: Actor, id: string, archived: boolean) {
  await getAccount(db, actor, id);
  await db
    .update(accounts)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(accounts.id, id), eq(accounts.userId, actor.id)));
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "account",
    entityId: id,
    action: archived ? "borrar" : "restaurar",
  });
}

/**
 * "Mi saldo real es X": crea un movimiento de corrección por la diferencia (no cuenta como
 * gasto ni ingreso). Para crédito, `realTyped` es lo que debes. Devuelve el movimiento o null.
 */
export async function adjustBalance(db: DbOrTx, actor: Actor, id: string, realTyped: Cents) {
  const account = await getAccount(db, actor, id);
  if (account.archivedAt) throw new AuthzError("Esa cuenta está archivada.");
  const target = toInternalBalance(account.kind, realTyped);
  const diff = target - account.balance;
  if (diff === 0) return null;
  const [tx] = await db
    .insert(transactions)
    .values({
      userId: actor.id,
      kind: "ajuste",
      amount: Math.abs(diff),
      date: todayIso(),
      fromAccountId: diff < 0 ? id : null,
      toAccountId: diff > 0 ? id : null,
      note: "Corrección de saldo",
    })
    .returning();
  await audit(db, {
    householdId: actor.householdId,
    actorUserId: actor.id,
    entity: "transaction",
    entityId: tx.id,
    action: "crear",
    after: tx,
  });
  return tx;
}
