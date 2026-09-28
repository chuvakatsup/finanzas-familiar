import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { AuthzError, type Actor } from "@/server/authz";
import { createAccount, listAccounts } from "@/server/services/accounts";
import { getMonthReport } from "@/server/services/balance";
import { getBudgets, saveBudgets } from "@/server/services/budget";
import { listCategories } from "@/server/services/categories";
import { getPrefs, updatePrefs } from "@/server/services/prefs";
import { confirmOccurrence, createScheduled } from "@/server/services/scheduled";
import { createExpense, createIncome, createTransfer } from "@/server/services/transactions";
import { makeHousehold, resetDb } from "../support/db";

beforeEach(resetDb);
afterAll(closeDb);

const TODAY = "2026-09-21";
const db = () => getDb();

async function setup() {
  const { member, admin } = await makeHousehold();
  const actor: Actor = member;
  const [efectivo] = await listAccounts(db(), actor);
  const none = { last4: null, creditLimit: null, statementDay: null, paymentDueDay: null };
  const banco = await createAccount(db(), actor, { ...none, kind: "debito", name: "Banco", balance: 500_000 });
  const tarjeta = await createAccount(db(), actor, { ...none, kind: "credito", name: "Tarjeta", balance: 0 });
  const gastos = await listCategories(db(), actor, "gasto");
  const ingresos = await listCategories(db(), actor, "ingreso");
  const g = (n: string) => gastos.find((c) => c.name === n)!.id;
  const i = (n: string) => ingresos.find((c) => c.name === n)!.id;
  return { actor, other: admin as Actor, efectivo, banco, tarjeta, g, i };
}

describe("balance del mes con datos reales", () => {
  it("mamá con pensión quincenal, luz pendiente, súper con tarjeta y pago de tarjeta", async () => {
    const s = await setup();
    const pension = await createScheduled(db(), s.actor, {
      kind: "ingreso", name: "Pensión", amount: 600_000, amountIsEstimate: false, frequency: "quincenal",
      nextDate: null, day1: 15, day2: 31, accountId: s.banco.id, categoryId: s.i("Pensión"), autoRegister: false,
    }, TODAY);
    await confirmOccurrence(db(), s.actor, pension.id, "2026-09-15", {}, TODAY); // ya llegó la del 15
    await createScheduled(db(), s.actor, {
      kind: "pago", name: "Luz", amount: 45_000, amountIsEstimate: true, frequency: "mensual",
      nextDate: null, day1: 25, day2: null, accountId: s.banco.id, categoryId: s.g("Luz, agua y gas"), autoRegister: false,
    }, TODAY);
    await createExpense(db(), s.actor, { amount: 120_000, categoryId: s.g("Súper"), accountId: s.tarjeta.id, date: "2026-09-10", note: null });
    await createExpense(db(), s.actor, { amount: 30_000, categoryId: s.g("Comida"), accountId: s.efectivo.id, date: "2026-09-12", note: null });
    await createTransfer(db(), s.actor, { amount: 120_000, fromAccountId: s.banco.id, toAccountId: s.tarjeta.id, date: "2026-09-20", note: null });
    // Otro mes: no debe contar.
    await createIncome(db(), s.actor, { amount: 999_999, categoryId: s.i("Venta"), accountId: s.banco.id, date: "2026-08-31", note: null });

    const r = await getMonthReport(db(), s.actor, "2026-09", TODAY);
    const b = r.balance;
    expect(b.income).toEqual({ received: 600_000, expected: 600_000, total: 1_200_000 });
    expect(b.commitments).toBe(45_000);
    expect(b.spent.total).toBe(150_000); // el pago de tarjeta NO suma
    expect(b.result).toBe(1_200_000 - 150_000 - 45_000);
    expect(b.status).toBe("verde");
    expect(r.byCategory.map((c) => [c.name, c.total])).toEqual([
      ["Súper", 120_000],
      ["Comida", 30_000],
    ]);
  });

  it("presupuesto: aparta lo que falta y marca límites por categoría", async () => {
    const s = await setup();
    await createIncome(db(), s.actor, { amount: 1_000_000, categoryId: s.i("Sueldo"), accountId: s.banco.id, date: "2026-09-01", note: null });
    await createExpense(db(), s.actor, { amount: 60_000, categoryId: s.g("Comida"), accountId: s.efectivo.id, date: "2026-09-05", note: null });
    await saveBudgets(db(), s.actor, { general: 400_000, byCategory: { [s.g("Comida")]: 50_000, [s.g("Ropa")]: 80_000 } });

    const r = await getMonthReport(db(), s.actor, "2026-09", TODAY);
    expect(r.balance.budgetLeft).toBe(340_000);
    expect(r.balance.expectedVariable).toBe(340_000);
    expect(r.balance.result).toBe(1_000_000 - 60_000 - 340_000);
    // 10 días restantes (21–30): min(disponible 940,000, restante 340,000) / 10
    expect(r.balance.dailyAllowance).toBe(34_000);
    const comida = r.byCategory.find((c) => c.name === "Comida")!;
    expect(comida).toMatchObject({ total: 60_000, limit: 50_000 });
    // Ropa tiene límite aunque no haya gasto: se muestra en $0.
    expect(r.byCategory.find((c) => c.name === "Ropa")).toMatchObject({ total: 0, limit: 80_000 });

    // Guardar otra vez reemplaza (no duplica) y 0 = sin límite.
    await saveBudgets(db(), s.actor, { general: null, byCategory: { [s.g("Comida")]: 0 } });
    expect(await getBudgets(db(), s.actor)).toEqual({ general: null, byCategory: {} });
  });

  it("umbral configurable del amarillo", async () => {
    const s = await setup();
    await createIncome(db(), s.actor, { amount: 1_000_000, categoryId: s.i("Sueldo"), accountId: s.banco.id, date: "2026-09-01", note: null });
    await createExpense(db(), s.actor, { amount: 850_000, categoryId: s.g("Casa"), accountId: s.banco.id, date: "2026-09-02", note: null });
    expect((await getMonthReport(db(), s.actor, "2026-09", TODAY)).balance.status).toBe("verde"); // sobra 15% > 10%
    await updatePrefs(db(), s.actor, { umbralAmarillo: 20 });
    expect((await getMonthReport(db(), s.actor, "2026-09", TODAY)).balance.status).toBe("amarillo");
    // updatePrefs mezcla, no borra otras preferencias.
    await updatePrefs(db(), s.actor, { letra: "grande" });
    expect(await getPrefs(db(), s.actor)).toMatchObject({ umbralAmarillo: 20, letra: "grande" });
  });
});

describe("aislamiento del balance y presupuesto", () => {
  it("el balance solo usa mis datos; no puedo poner límites con categorías ajenas", async () => {
    const s = await setup();
    await createIncome(db(), s.actor, { amount: 777_000, categoryId: s.i("Sueldo"), accountId: s.banco.id, date: "2026-09-01", note: null });
    const otherReport = await getMonthReport(db(), s.other, "2026-09", TODAY);
    expect(otherReport.balance.income.total).toBe(0);
    expect(otherReport.balance.status).toBe("sin-datos");
    await expect(saveBudgets(db(), s.other, { general: 100, byCategory: { [s.g("Comida")]: 100 } })).rejects.toBeInstanceOf(
      AuthzError,
    );
  });
});
