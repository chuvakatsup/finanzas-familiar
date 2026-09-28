import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { auditLog, categories } from "@/server/db/schema";
import { AuthzError } from "@/server/authz";
import type { Actor } from "@/server/authz";
import {
  adjustBalance,
  createAccount,
  getAccount,
  listAccounts,
  setAccountArchived,
} from "@/server/services/accounts";
import { ensureUserDefaults, listCategories } from "@/server/services/categories";
import {
  createExpense,
  createIncome,
  createTransfer,
  deleteTransaction,
  lastUsedAccountId,
  listTransactions,
  restoreTransaction,
  updateTransaction,
} from "@/server/services/transactions";
import { summarize } from "@/domain/summary";
import { makeHousehold, resetDb } from "../support/db";

beforeEach(resetDb);
afterAll(closeDb);

const D = "2026-09-15";
const db = () => getDb();

async function setup() {
  const { member } = await makeHousehold();
  const actor: Actor = member;
  const [efectivo] = await listAccounts(db(), actor);
  const debito = await createAccount(db(), actor, {
    kind: "debito", name: "Banco", balance: 1_000_000, last4: "1234", creditLimit: null, statementDay: null, paymentDueDay: null,
  });
  const tarjeta = await createAccount(db(), actor, {
    kind: "credito", name: "Tarjeta", balance: 200_000, last4: null, creditLimit: 2_000_000, statementDay: 5, paymentDueDay: 25,
  });
  const gastos = await listCategories(db(), actor, "gasto");
  const ingresos = await listCategories(db(), actor, "ingreso");
  const cat = (n: string) => gastos.find((c) => c.name === n)!.id;
  return { actor, efectivo, debito, tarjeta, gastos, ingresos, cat };
}

const bal = async (actor: Actor, id: string) => (await getAccount(db(), actor, id)).balance;

describe("datos iniciales", () => {
  it("cada persona empieza con categorías y una cuenta Efectivo, sin duplicar", async () => {
    const { member } = await makeHousehold();
    await ensureUserDefaults(db(), member.id);
    const accounts = await listAccounts(db(), member);
    expect(accounts.map((a) => a.name)).toEqual(["Efectivo"]);
    const gastos = await listCategories(db(), member, "gasto");
    expect(gastos.length).toBeGreaterThan(5);
    expect(new Set(gastos.map((c) => c.name)).size).toBe(gastos.length);
  });
});

describe("saldos y reglas sin doble conteo", () => {
  it("la tarjeta de crédito arranca con su deuda en negativo", async () => {
    const { actor, tarjeta, debito } = await setup();
    expect(await bal(actor, tarjeta.id)).toBe(-200_000);
    expect(await bal(actor, debito.id)).toBe(1_000_000);
  });

  it("gasto con tarjeta sube la deuda; pagarla la baja y NO es gasto nuevo", async () => {
    const { actor, tarjeta, debito, cat } = await setup();
    await createExpense(db(), actor, { amount: 50_000, categoryId: cat("Salud"), accountId: tarjeta.id, date: D, note: null });
    expect(await bal(actor, tarjeta.id)).toBe(-250_000);

    const pago = await createTransfer(db(), actor, {
      amount: 250_000, fromAccountId: debito.id, toAccountId: tarjeta.id, date: D, note: null,
    });
    expect(pago.kind).toBe("pago_tarjeta");
    expect(await bal(actor, tarjeta.id)).toBe(0);
    expect(await bal(actor, debito.id)).toBe(750_000);

    const rows = await listTransactions(db(), actor, { from: "2026-09-01", to: "2026-09-30" });
    expect(summarize(rows).spent).toBe(50_000);
  });

  it("ingreso entra a la cuenta y no puede ir a tarjeta de crédito", async () => {
    const { actor, debito, tarjeta, ingresos } = await setup();
    await createIncome(db(), actor, { amount: 300_000, categoryId: ingresos[0].id, accountId: debito.id, date: D, note: "Quincena" });
    expect(await bal(actor, debito.id)).toBe(1_300_000);
    await expect(
      createIncome(db(), actor, { amount: 1, categoryId: ingresos[0].id, accountId: tarjeta.id, date: D, note: null }),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("no acepta categoría de ingreso en un gasto", async () => {
    const { actor, efectivo, ingresos } = await setup();
    await expect(
      createExpense(db(), actor, { amount: 100, categoryId: ingresos[0].id, accountId: efectivo.id, date: D, note: null }),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("corregir saldo crea un ajuste por la diferencia (no es gasto)", async () => {
    const { actor, efectivo, tarjeta } = await setup();
    const tx = await adjustBalance(db(), actor, efectivo.id, 45_000);
    expect(tx?.kind).toBe("ajuste");
    expect(await bal(actor, efectivo.id)).toBe(45_000);
    // En crédito se escribe lo que se debe.
    await adjustBalance(db(), actor, tarjeta.id, 180_000);
    expect(await bal(actor, tarjeta.id)).toBe(-180_000);
    expect(await adjustBalance(db(), actor, efectivo.id, 45_000)).toBeNull();
    const rows = await listTransactions(db(), actor);
    expect(summarize(rows)).toEqual({ spent: 0, received: 0, supportSent: 0 });
  });
});

describe("borrar, deshacer y editar", () => {
  it("borrar saca el movimiento del saldo; deshacer lo regresa; todo queda auditado", async () => {
    const { actor, efectivo, cat } = await setup();
    const tx = await createExpense(db(), actor, { amount: 12_000, categoryId: cat("Comida"), accountId: efectivo.id, date: D, note: null });
    expect(await bal(actor, efectivo.id)).toBe(-12_000);
    await deleteTransaction(db(), actor, tx.id);
    expect(await bal(actor, efectivo.id)).toBe(0);
    expect(await listTransactions(db(), actor)).toHaveLength(0);
    await restoreTransaction(db(), actor, tx.id);
    expect(await bal(actor, efectivo.id)).toBe(-12_000);
    const log = await db().select().from(auditLog).where(and(eq(auditLog.entity, "transaction"), eq(auditLog.entityId, tx.id)));
    expect(log.map((l) => l.action).sort()).toEqual(["borrar", "crear", "restaurar"]);
  });

  it("editar un gasto cambia monto y cuenta; editar transferencia recalcula su tipo", async () => {
    const { actor, efectivo, debito, tarjeta, cat } = await setup();
    const g = await createExpense(db(), actor, { amount: 10_000, categoryId: cat("Comida"), accountId: efectivo.id, date: D, note: null });
    await updateTransaction(db(), actor, g.id, { amount: 15_000, categoryId: cat("Súper"), accountId: debito.id, date: D, note: "cambio" });
    expect(await bal(actor, efectivo.id)).toBe(0);
    expect(await bal(actor, debito.id)).toBe(985_000);

    const t = await createTransfer(db(), actor, { amount: 5_000, fromAccountId: debito.id, toAccountId: efectivo.id, date: D, note: null });
    expect(t.kind).toBe("transferencia");
    const edited = await updateTransaction(db(), actor, t.id, {
      amount: 5_000, fromAccountId: debito.id, toAccountId: tarjeta.id, date: D, note: null,
    });
    expect(edited.kind).toBe("pago_tarjeta");
  });

  it("una cuenta archivada no se puede usar para movimientos nuevos", async () => {
    const { actor, debito, cat } = await setup();
    await setAccountArchived(db(), actor, debito.id, true);
    await expect(
      createExpense(db(), actor, { amount: 100, categoryId: cat("Comida"), accountId: debito.id, date: D, note: null }),
    ).rejects.toBeInstanceOf(AuthzError);
    expect((await listAccounts(db(), actor)).some((a) => a.id === debito.id)).toBe(false);
  });
});

describe("consultas", () => {
  it("filtra por mes, cuenta, categoría y búsqueda (texto o monto)", async () => {
    const { actor, efectivo, debito, cat } = await setup();
    await createExpense(db(), actor, { amount: 15_000, categoryId: cat("Comida"), accountId: efectivo.id, date: "2026-09-10", note: "tacos" });
    await createExpense(db(), actor, { amount: 45_050, categoryId: cat("Súper"), accountId: debito.id, date: "2026-09-12", note: "Soriana" });
    await createExpense(db(), actor, { amount: 9_900, categoryId: cat("Comida"), accountId: efectivo.id, date: "2026-08-30", note: null });

    const sept = await listTransactions(db(), actor, { from: "2026-09-01", to: "2026-09-30" });
    expect(sept).toHaveLength(2);
    expect(sept[0].date).toBe("2026-09-12"); // más reciente primero
    expect(await listTransactions(db(), actor, { accountId: debito.id })).toHaveLength(1);
    expect(await listTransactions(db(), actor, { categoryId: cat("Comida") })).toHaveLength(2);
    expect((await listTransactions(db(), actor, { q: "soriana" }))[0].amount).toBe(45_050);
    expect((await listTransactions(db(), actor, { q: "súper" }))[0].amount).toBe(45_050);
    expect((await listTransactions(db(), actor, { q: "150" }))[0].note).toBe("tacos");
    expect(await listTransactions(db(), actor, { q: "100%" })).toHaveLength(0);
  });

  it("propone la última cuenta usada", async () => {
    const { actor, debito, cat } = await setup();
    expect(await lastUsedAccountId(db(), actor, "gasto")).toBeNull();
    await createExpense(db(), actor, { amount: 100, categoryId: cat("Comida"), accountId: debito.id, date: D, note: null });
    expect(await lastUsedAccountId(db(), actor, "gasto")).toBe(debito.id);
  });

  it("la BD rechaza montos cero o negativos aunque alguien salte la validación", async () => {
    const { actor, efectivo, cat } = await setup();
    await expect(
      createExpense(db(), actor, { amount: 0, categoryId: cat("Comida"), accountId: efectivo.id, date: D, note: null }),
    ).rejects.toThrow();
    const n = await db().select().from(categories).where(eq(categories.userId, actor.id));
    expect(n.length).toBeGreaterThan(0);
  });
});
