import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { scheduledItems, transactions } from "@/server/db/schema";
import { AuthzError, type Actor } from "@/server/authz";
import { createAccount, getAccount, listAccounts } from "@/server/services/accounts";
import { listCategories } from "@/server/services/categories";
import {
  confirmOccurrence,
  createScheduled,
  listDue,
  listScheduled,
  listUpcoming,
  setScheduledArchived,
  skipOccurrence,
  syncAutoOccurrences,
  undoOccurrence,
  updateScheduled,
} from "@/server/services/scheduled";
import { deleteTransaction, getTransaction, restoreTransaction } from "@/server/services/transactions";
import type { ScheduledFormInput } from "@/lib/schemas/finance";
import { makeHousehold, resetDb } from "../support/db";

beforeEach(resetDb);
afterAll(closeDb);

const TODAY = "2026-09-28";
const db = () => getDb();

async function setup() {
  const { member, admin } = await makeHousehold();
  const actor: Actor = member;
  const [efectivo] = await listAccounts(db(), actor);
  const banco = await createAccount(db(), actor, {
    kind: "debito", name: "Banco", balance: 1_000_000, last4: null, creditLimit: null, statementDay: null, paymentDueDay: null,
  });
  const tarjeta = await createAccount(db(), actor, {
    kind: "credito", name: "Tarjeta", balance: 0, last4: null, creditLimit: null, statementDay: null, paymentDueDay: null,
  });
  const gasto = (n: string) => listCategories(db(), actor, "gasto").then((c) => c.find((x) => x.name === n)!.id);
  const ingreso = (n: string) => listCategories(db(), actor, "ingreso").then((c) => c.find((x) => x.name === n)!.id);
  const luz: ScheduledFormInput = {
    kind: "pago", name: "Luz CFE", amount: 45_000, amountIsEstimate: true, frequency: "mensual",
    nextDate: null, day1: 5, day2: null, accountId: banco.id, categoryId: await gasto("Luz, agua y gas"), autoRegister: false,
  };
  const pension: ScheduledFormInput = {
    kind: "ingreso", name: "Pensión", amount: 1_200_000, amountIsEstimate: false, frequency: "quincenal",
    nextDate: null, day1: 15, day2: 31, accountId: banco.id, categoryId: await ingreso("Pensión"), autoRegister: false,
  };
  return { actor, other: admin as Actor, efectivo, banco, tarjeta, luz, pension };
}

const bal = async (actor: Actor, id: string) => (await getAccount(db(), actor, id)).balance;

describe("programados: alta y fechas", () => {
  it("mensual/quincenal empiezan el 1° del mes para contar lo de este mes", async () => {
    const s = await setup();
    const item = await createScheduled(db(), s.actor, s.pension, TODAY);
    expect(item.startDate).toBe("2026-09-01");
    const due = await listDue(db(), s.actor, "2026-09-01", "2026-10-31");
    expect(due.map((d) => d.dueDate)).toEqual(["2026-09-15", "2026-09-30", "2026-10-15", "2026-10-31"]);
    expect(due.every((d) => d.status === "pendiente")).toBe(true);
  });

  it("vencidos y próximos, y la siguiente fecha en la lista", async () => {
    const s = await setup();
    await createScheduled(db(), s.actor, s.luz, TODAY);
    await createScheduled(db(), s.actor, s.pension, TODAY);
    const { overdue, upcoming } = await listUpcoming(db(), s.actor, 30, TODAY);
    expect(overdue.map((d) => `${d.name} ${d.dueDate}`)).toEqual(["Luz CFE 2026-09-05", "Pensión 2026-09-15"]);
    expect(upcoming.map((d) => d.dueDate)).toEqual(["2026-09-30", "2026-10-05", "2026-10-15"]);
    const list = await listScheduled(db(), s.actor, "pago", { today: TODAY });
    expect(list[0].nextDate).toBe("2026-10-05");
  });

  it("un ingreso no puede llegar a una tarjeta de crédito", async () => {
    const s = await setup();
    await expect(createScheduled(db(), s.actor, { ...s.pension, accountId: s.tarjeta.id }, TODAY)).rejects.toBeInstanceOf(AuthzError);
  });

  it("editar sin cambiar el calendario conserva las fechas pasadas", async () => {
    const s = await setup();
    const item = await createScheduled(db(), s.actor, { ...s.luz, frequency: "bimestral", nextDate: "2026-08-20", day1: null }, TODAY);
    const edited = await updateScheduled(db(), s.actor, item.id, { ...s.luz, frequency: "bimestral", nextDate: "2026-10-20", day1: null, amount: 50_000 }, TODAY);
    expect(edited.startDate).toBe("2026-08-20");
    expect(edited.amount).toBe(50_000);
  });
});

describe("confirmar, saltar y deshacer", () => {
  it("'Ya lo pagué' crea el gasto real con el monto ajustado y marca la fecha", async () => {
    const s = await setup();
    const item = await createScheduled(db(), s.actor, s.luz, TODAY);
    const tx = await confirmOccurrence(db(), s.actor, item.id, "2026-09-05", { amount: 51_230 }, TODAY);
    expect(tx).toMatchObject({ kind: "gasto", amount: 51_230, date: "2026-09-05", origin: "recurrente", sourceId: item.id });
    expect(await bal(s.actor, s.banco.id)).toBe(1_000_000 - 51_230);
    const [d] = await listDue(db(), s.actor, "2026-09-05", "2026-09-05");
    expect(d).toMatchObject({ status: "confirmado", actualAmount: 51_230 });
    // No se puede confirmar dos veces.
    await expect(confirmOccurrence(db(), s.actor, item.id, "2026-09-05", {}, TODAY)).rejects.toBeInstanceOf(AuthzError);
  });

  it("confirmar antes de la fecha registra con fecha de hoy", async () => {
    const s = await setup();
    const item = await createScheduled(db(), s.actor, s.pension, TODAY);
    const tx = await confirmOccurrence(db(), s.actor, item.id, "2026-09-30", {}, TODAY);
    expect(tx).toMatchObject({ kind: "ingreso", date: TODAY, amount: 1_200_000 });
  });

  it("solo acepta fechas reales del calendario", async () => {
    const s = await setup();
    const item = await createScheduled(db(), s.actor, s.luz, TODAY);
    await expect(confirmOccurrence(db(), s.actor, item.id, "2026-09-06", {}, TODAY)).rejects.toBeInstanceOf(AuthzError);
  });

  it("deshacer borra el movimiento y deja la fecha pendiente; saltar no crea movimiento", async () => {
    const s = await setup();
    const item = await createScheduled(db(), s.actor, s.luz, TODAY);
    const tx = await confirmOccurrence(db(), s.actor, item.id, "2026-09-05", {}, TODAY);
    await undoOccurrence(db(), s.actor, item.id, "2026-09-05");
    expect((await getTransaction(db(), s.actor, tx.id)).deletedAt).not.toBeNull();
    expect(await bal(s.actor, s.banco.id)).toBe(1_000_000);
    expect((await listDue(db(), s.actor, "2026-09-05", "2026-09-05"))[0].status).toBe("pendiente");

    await skipOccurrence(db(), s.actor, item.id, "2026-09-05");
    expect((await listDue(db(), s.actor, "2026-09-05", "2026-09-05"))[0].status).toBe("omitido");
    expect(await bal(s.actor, s.banco.id)).toBe(1_000_000);
    await undoOccurrence(db(), s.actor, item.id, "2026-09-05");
    expect((await listDue(db(), s.actor, "2026-09-05", "2026-09-05"))[0].status).toBe("pendiente");
  });

  it("borrar el movimiento desde el historial deja la fecha pendiente otra vez", async () => {
    const s = await setup();
    const item = await createScheduled(db(), s.actor, s.luz, TODAY);
    const tx = await confirmOccurrence(db(), s.actor, item.id, "2026-09-05", {}, TODAY);
    await deleteTransaction(db(), s.actor, tx.id);
    expect((await listDue(db(), s.actor, "2026-09-05", "2026-09-05"))[0].status).toBe("pendiente");
    // Se vuelve a confirmar; recuperar el viejo contaría doble y se impide.
    await confirmOccurrence(db(), s.actor, item.id, "2026-09-05", {}, TODAY);
    await expect(restoreTransaction(db(), s.actor, tx.id)).rejects.toBeInstanceOf(AuthzError);
  });

  it("dos confirmaciones al mismo tiempo solo registran una", async () => {
    const s = await setup();
    const item = await createScheduled(db(), s.actor, s.luz, TODAY);
    const attempt = () =>
      db().transaction((t) => confirmOccurrence(t, s.actor, item.id, "2026-09-05", {}, TODAY));
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const txs = await db().select().from(transactions).where(eq(transactions.sourceId, item.id));
    expect(txs).toHaveLength(1);
  });

  it("un programado quitado ya no aparece", async () => {
    const s = await setup();
    const item = await createScheduled(db(), s.actor, s.luz, TODAY);
    await setScheduledArchived(db(), s.actor, item.id, true);
    expect(await listDue(db(), s.actor, "2026-09-01", "2026-12-31")).toHaveLength(0);
  });
});

describe("domiciliados / depósitos automáticos", () => {
  it("se registran solos al llegar la fecha, sin duplicar y nunca antes del alta", async () => {
    const s = await setup();
    const item = await createScheduled(db(), s.actor, { ...s.luz, autoRegister: true, amountIsEstimate: false }, TODAY);
    // Dado de alta el 10 de septiembre: el del 5 de septiembre NO se genera solo.
    await db().update(scheduledItems).set({ createdAt: new Date("2026-09-10T18:00:00Z") }).where(eq(scheduledItems.id, item.id));

    expect(await syncAutoOccurrences(db(), s.actor, "2026-10-04")).toBe(0);
    expect(await syncAutoOccurrences(db(), s.actor, "2026-10-05")).toBe(1);
    expect(await syncAutoOccurrences(db(), s.actor, "2026-10-06")).toBe(0);
    const due = await listDue(db(), s.actor, "2026-09-01", "2026-10-31");
    expect(due.map((d) => `${d.dueDate} ${d.status}`)).toEqual(["2026-09-05 pendiente", "2026-10-05 confirmado"]);
  });

  it("si la persona borra el automático, no se vuelve a crear", async () => {
    const s = await setup();
    const item = await createScheduled(db(), s.actor, { ...s.luz, autoRegister: true }, TODAY);
    await db().update(scheduledItems).set({ createdAt: new Date("2026-09-01T18:00:00Z") }).where(eq(scheduledItems.id, item.id));
    await syncAutoOccurrences(db(), s.actor, TODAY);
    const [d] = await listDue(db(), s.actor, "2026-09-05", "2026-09-05");
    await deleteTransaction(db(), s.actor, d.transactionId!);
    expect(await syncAutoOccurrences(db(), s.actor, TODAY)).toBe(0);
  });
});

describe("aislamiento", () => {
  it("nadie ve, confirma, salta, deshace ni edita programados de otro", async () => {
    const s = await setup();
    const item = await createScheduled(db(), s.actor, s.luz, TODAY);
    expect(await listScheduled(db(), s.other, "pago")).toHaveLength(0);
    expect(await listDue(db(), s.other, "2026-01-01", "2026-12-31")).toHaveLength(0);
    await expect(confirmOccurrence(db(), s.other, item.id, "2026-09-05", {}, TODAY)).rejects.toBeInstanceOf(AuthzError);
    await expect(skipOccurrence(db(), s.other, item.id, "2026-09-05")).rejects.toBeInstanceOf(AuthzError);
    await expect(undoOccurrence(db(), s.other, item.id, "2026-09-05")).rejects.toBeInstanceOf(AuthzError);
    await expect(updateScheduled(db(), s.other, item.id, s.luz, TODAY)).rejects.toBeInstanceOf(AuthzError);
    await expect(setScheduledArchived(db(), s.other, item.id, true)).rejects.toBeInstanceOf(AuthzError);
    // Tampoco puede crear un programado usando la cuenta de otro.
    await expect(createScheduled(db(), s.other, s.luz, TODAY)).rejects.toBeInstanceOf(AuthzError);
    // Ni forzar el uso de la cuenta ajena al confirmar el suyo.
    const [otherCash] = await listAccounts(db(), s.other);
    const otherCats = await listCategories(db(), s.other, "gasto");
    const own = await createScheduled(db(), s.other, { ...s.luz, accountId: otherCash.id, categoryId: otherCats[0].id }, TODAY);
    await expect(
      confirmOccurrence(db(), s.other, own.id, "2026-09-05", { accountId: s.banco.id }, TODAY),
    ).rejects.toBeInstanceOf(AuthzError);
  });
});
