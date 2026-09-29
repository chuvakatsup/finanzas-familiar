import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { users } from "@/server/db/schema";
import { AuthzError, type Actor } from "@/server/authz";
import { createAccount, getAccount } from "@/server/services/accounts";
import { getMonthReport } from "@/server/services/balance";
import { listCategories } from "@/server/services/categories";
import {
  confirmSharedReceived,
  dismissRejectedShared,
  listShared,
  markSharedPaid,
  rejectShared,
  shareExpense,
  sharedForTx,
  sharedInbox,
  sharedTotals,
  undoRejectShared,
  undoSharedPaid,
  undoSharedReceived,
  unshareExpense,
} from "@/server/services/shared";
import {
  createExpense,
  deleteTransaction,
  listTransactions,
  restoreTransaction,
  updateTransaction,
} from "@/server/services/transactions";
import { makeHousehold, resetDb } from "../support/db";

beforeEach(resetDb);
afterAll(closeDb);

const db = () => getDb();
const none = { last4: null, creditLimit: null, statementDay: null, paymentDueDay: null };
const TODAY = "2026-09-20";
const MONTH = "2026-09";

async function setup() {
  const fam = await makeHousehold("Familia");
  const hijo: Actor = fam.admin;
  const mama: Actor = fam.member;
  const tarjetaHijo = await createAccount(db(), hijo, { ...none, kind: "credito", name: "Tarjeta hijo", balance: 0 });
  const bancoHijo = await createAccount(db(), hijo, { ...none, kind: "debito", name: "Banco hijo", balance: 500_000 });
  const bancoMama = await createAccount(db(), mama, { ...none, kind: "debito", name: "Banco mamá", balance: 200_000 });
  const [comida] = await listCategories(db(), hijo, "gasto");
  const gasto = await createExpense(db(), hijo, {
    amount: 100_000, categoryId: comida.id, accountId: tarjetaHijo.id, date: TODAY, note: "Súper",
  });
  return { fam, hijo, mama, tarjetaHijo, bancoHijo, bancoMama, comida, gasto };
}

const bal = async (a: Actor, id: string) => (await getAccount(db(), a, id)).balance;
const report = (a: Actor) => getMonthReport(db(), a, MONTH, TODAY);
const half = (userId: string) => ({ mode: "porcentaje" as const, parts: [{ userId, value: 5000 }] });

describe("repartir un gasto", () => {
  it("50%: la tarjeta carga todo, pero al dueño solo le cuenta su mitad y a mamá la suya como compromiso", async () => {
    const s = await setup();
    const before = (await report(s.hijo)).balance;
    expect(before.spent.variable).toBe(100_000);

    const [debt] = await shareExpense(db(), s.hijo, s.gasto.id, half(s.mama.id));
    expect(debt).toMatchObject({ amount: 50_000, percentBp: 5000, status: "pendiente", concept: "Súper", date: TODAY });

    // La deuda real de la tarjeta no cambia: sigue siendo el cargo completo.
    expect(await bal(s.hijo, s.tarjetaHijo.id)).toBe(-100_000);
    const hijo = await report(s.hijo);
    expect(hijo.balance.spent.variable).toBe(50_000);
    expect(hijo.shared.sharedOutTotal).toBe(50_000);
    expect(hijo.byCategory.find((c) => c.categoryId === s.comida.id)?.total).toBe(50_000);

    const mama = await report(s.mama);
    expect(mama.balance.commitments).toBe(50_000);
    expect(mama.shared.owed).toEqual([{ amount: 50_000, date: TODAY, to: "Admin", concept: "Súper" }]);
  });

  it("por cantidad y con el 100% para otra persona", async () => {
    const s = await setup();
    await shareExpense(db(), s.hijo, s.gasto.id, { mode: "monto", parts: [{ userId: s.mama.id, value: 100_000 }] });
    expect((await report(s.hijo)).balance.spent.variable).toBe(0);
    expect((await report(s.mama)).balance.commitments).toBe(100_000);
  });

  it("no se puede: consigo mismo, con gente de otra familia, dos veces, ni gastos ajenos o generados", async () => {
    const s = await setup();
    const otra = await makeHousehold("Otra");
    await expect(shareExpense(db(), s.hijo, s.gasto.id, half(s.hijo.id))).rejects.toBeInstanceOf(AuthzError);
    await expect(shareExpense(db(), s.hijo, s.gasto.id, half(otra.member.id))).rejects.toBeInstanceOf(AuthzError);
    await expect(shareExpense(db(), s.mama, s.gasto.id, half(s.hijo.id))).rejects.toBeInstanceOf(AuthzError);
    await expect(
      shareExpense(db(), s.hijo, s.gasto.id, { mode: "porcentaje", parts: [{ userId: s.mama.id, value: 10_001 }] }),
    ).rejects.toThrow("más de 100%");
    await shareExpense(db(), s.hijo, s.gasto.id, half(s.mama.id));
    await expect(shareExpense(db(), s.hijo, s.gasto.id, half(s.mama.id))).rejects.toThrow("ya está compartido");
  });
});

describe("pagar la parte y confirmar", () => {
  it("mamá paga → es su gasto; hijo confirma directo a la tarjeta → baja la deuda sin contar como ingreso", async () => {
    const s = await setup();
    const [debt] = await shareExpense(db(), s.hijo, s.gasto.id, half(s.mama.id));

    await markSharedPaid(db(), s.mama, debt.id, { fromAccountId: s.bancoMama.id }, TODAY);
    expect(await bal(s.mama, s.bancoMama.id)).toBe(150_000);
    const mama = await report(s.mama);
    expect(mama.balance.commitments).toBe(0); // ya no es pendiente…
    expect(mama.balance.spent.total).toBe(50_000); // …es gasto real
    const [paidTx] = await listTransactions(db(), s.mama);
    expect(paidTx).toMatchObject({ kind: "gasto", origin: "compartido", categoryName: "Gastos compartidos" });
    // Ese movimiento no se edita ni borra suelto.
    await expect(deleteTransaction(db(), s.mama, paidTx.id)).rejects.toBeInstanceOf(AuthzError);

    // El hijo lo ve como "¿te llegó?" en su bandeja.
    const inbox = await sharedInbox(db(), s.hijo, TODAY);
    expect(inbox.map((i) => [i.id, i.status, i.iAmOwner])).toEqual([[debt.id, "pagado", true]]);

    const incomeBefore = (await report(s.hijo)).balance.income.total;
    await confirmSharedReceived(db(), s.hijo, debt.id, { accountId: s.tarjetaHijo.id }, TODAY);
    expect(await bal(s.hijo, s.tarjetaHijo.id)).toBe(-50_000);
    const hijo = await report(s.hijo);
    expect(hijo.balance.income.total).toBe(incomeBefore); // reembolso ≠ ingreso
    expect(hijo.balance.spent.variable).toBe(50_000);

    // Deshacer en orden: el hijo, luego mamá.
    await expect(undoSharedPaid(db(), s.mama, debt.id)).rejects.toThrow("Ya se confirmó");
    await undoSharedReceived(db(), s.hijo, debt.id);
    expect(await bal(s.hijo, s.tarjetaHijo.id)).toBe(-100_000);
    await undoSharedPaid(db(), s.mama, debt.id);
    expect(await bal(s.mama, s.bancoMama.id)).toBe(200_000);
    expect((await report(s.mama)).balance.commitments).toBe(50_000);
  });

  it("solo cada quien hace su parte del flujo", async () => {
    const s = await setup();
    const [debt] = await shareExpense(db(), s.hijo, s.gasto.id, half(s.mama.id));
    await expect(markSharedPaid(db(), s.hijo, debt.id, { fromAccountId: s.bancoHijo.id })).rejects.toBeInstanceOf(AuthzError);
    await expect(confirmSharedReceived(db(), s.hijo, debt.id, { accountId: s.bancoHijo.id })).rejects.toThrow("Todavía no");
    // Mamá no puede pagar con una cuenta ajena.
    await expect(markSharedPaid(db(), s.mama, debt.id, { fromAccountId: s.bancoHijo.id })).rejects.toBeInstanceOf(AuthzError);
    await markSharedPaid(db(), s.mama, debt.id, { fromAccountId: s.bancoMama.id }, TODAY);
    await expect(confirmSharedReceived(db(), s.mama, debt.id, { accountId: s.bancoMama.id })).rejects.toBeInstanceOf(AuthzError);
    // El hijo no puede recibir en la cuenta de mamá.
    await expect(confirmSharedReceived(db(), s.hijo, debt.id, { accountId: s.bancoMama.id })).rejects.toBeInstanceOf(AuthzError);
    await expect(markSharedPaid(db(), s.mama, debt.id, { fromAccountId: s.bancoMama.id })).rejects.toThrow("ya se pagó");
  });
});

describe("'Esto no es mío'", () => {
  it("la parte vuelve a contar para el dueño, que recibe el aviso hasta decir 'Entendido'", async () => {
    const s = await setup();
    const [debt] = await shareExpense(db(), s.hijo, s.gasto.id, half(s.mama.id));
    await rejectShared(db(), s.mama, debt.id);
    expect((await report(s.hijo)).balance.spent.variable).toBe(100_000);
    expect((await report(s.mama)).balance.commitments).toBe(0);
    expect((await sharedInbox(db(), s.hijo, TODAY)).map((i) => i.status)).toEqual(["rechazado"]);

    await undoRejectShared(db(), s.mama, debt.id);
    expect((await report(s.mama)).balance.commitments).toBe(50_000);
    await rejectShared(db(), s.mama, debt.id);
    await dismissRejectedShared(db(), s.hijo, debt.id);
    expect(await sharedInbox(db(), s.hijo, TODAY)).toEqual([]);
  });
});

describe("cambios al gasto de origen", () => {
  it("borrarlo quita las partes para todos y deshacer las regresa; con pagos no se puede borrar", async () => {
    const s = await setup();
    const [debt] = await shareExpense(db(), s.hijo, s.gasto.id, half(s.mama.id));
    await deleteTransaction(db(), s.hijo, s.gasto.id);
    expect(await listShared(db(), s.mama)).toEqual([]);
    expect((await report(s.mama)).balance.commitments).toBe(0);
    await restoreTransaction(db(), s.hijo, s.gasto.id);
    expect(await listShared(db(), s.mama)).toHaveLength(1);

    await markSharedPaid(db(), s.mama, debt.id, { fromAccountId: s.bancoMama.id }, TODAY);
    await expect(deleteTransaction(db(), s.hijo, s.gasto.id)).rejects.toThrow("ya te pagó");
    await expect(unshareExpense(db(), s.hijo, s.gasto.id)).rejects.toThrow("ya te pagó");
  });

  it("el monto no se cambia mientras esté compartido; la fecha sí y las partes la siguen", async () => {
    const s = await setup();
    await shareExpense(db(), s.hijo, s.gasto.id, half(s.mama.id));
    const edit = { amount: 100_000, categoryId: s.comida.id, accountId: s.tarjetaHijo.id, date: TODAY, note: "Súper" };
    await expect(updateTransaction(db(), s.hijo, s.gasto.id, { ...edit, amount: 120_000 })).rejects.toThrow("quita el reparto");
    await updateTransaction(db(), s.hijo, s.gasto.id, { ...edit, date: "2026-09-10" });
    expect((await listShared(db(), s.mama))[0].date).toBe("2026-09-10");

    await unshareExpense(db(), s.hijo, s.gasto.id);
    expect(await sharedForTx(db(), s.hijo, s.gasto.id)).toEqual([]);
    expect((await report(s.hijo)).balance.spent.variable).toBe(100_000);
  });
});

describe("privacidad", () => {
  it("quien debe no ve la cuenta ni el gasto del dueño; un tercero de la familia no ve nada", async () => {
    const s = await setup();
    const [tercero] = await db()
      .insert(users)
      .values({ householdId: s.fam.household.id, name: "Tía", email: "tia@test.local", role: "miembro" })
      .returning();
    const tia: Actor = { id: tercero.id, householdId: tercero.householdId, role: tercero.role };
    const [debt] = await shareExpense(db(), s.hijo, s.gasto.id, half(s.mama.id));

    const [asMama] = await listShared(db(), s.mama);
    expect(asMama.sourceTxId).toBeNull();
    expect(JSON.stringify(asMama)).not.toContain("Tarjeta hijo");
    expect(await sharedForTx(db(), s.mama, s.gasto.id)).toEqual([]);

    expect(await listShared(db(), tia)).toEqual([]);
    expect(await sharedInbox(db(), tia, TODAY)).toEqual([]);
    await expect(markSharedPaid(db(), tia, debt.id, { fromAccountId: s.bancoMama.id })).rejects.toBeInstanceOf(AuthzError);
    await expect(rejectShared(db(), tia, debt.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(unshareExpense(db(), tia, s.gasto.id)).resolves.toBeUndefined();
    expect(await listShared(db(), s.mama)).toHaveLength(1);
  });

  it("totales: lo que me deben y lo que debo", async () => {
    const s = await setup();
    await shareExpense(db(), s.hijo, s.gasto.id, half(s.mama.id));
    expect(sharedTotals(await listShared(db(), s.hijo))).toEqual({ owedToMe: 50_000, iOwe: 0 });
    expect(sharedTotals(await listShared(db(), s.mama))).toEqual({ owedToMe: 0, iOwe: 50_000 });
  });
});
