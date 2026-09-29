import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { supportSchedules } from "@/server/db/schema";
import { AuthzError, type Actor } from "@/server/authz";
import { createAccount, getAccount, listAccounts } from "@/server/services/accounts";
import { getMonthReport } from "@/server/services/balance";
import { createLoan, getLoan } from "@/server/services/loans";
import { updatePrefs } from "@/server/services/prefs";
import {
  createSupportSchedule,
  debtsForApply,
  getSupport,
  listSupports,
  pendingToConfirm,
  receiveSupport,
  sendSupport,
  setSupportCancelled,
  snoozeSupport,
  syncSupportSchedules,
  undoReceiveSupport,
  updateSupport,
} from "@/server/services/support";
import { deleteTransaction, listTransactions } from "@/server/services/transactions";
import { makeHousehold, resetDb } from "../support/db";

beforeEach(resetDb);
afterAll(closeDb);

const db = () => getDb();
const none = { last4: null, creditLimit: null, statementDay: null, paymentDueDay: null };
const TODAY = "2026-09-20";

async function setup() {
  const fam = await makeHousehold("Familia");
  const hijo: Actor = fam.admin;
  const mama: Actor = fam.member;
  const bancoHijo = await createAccount(db(), hijo, { ...none, kind: "debito", name: "Banco hijo", balance: 1_000_000 });
  const bancoMama = await createAccount(db(), mama, { ...none, kind: "debito", name: "Banco mamá", balance: 100_000 });
  const tarjetaMama = await createAccount(db(), mama, { ...none, kind: "credito", name: "Liverpool", balance: 300_000 });
  return { hijo, mama, bancoHijo, bancoMama, tarjetaMama };
}

const bal = async (a: Actor, id: string) => (await getAccount(db(), a, id)).balance;

describe("enviar y recibir apoyos", () => {
  it("enviar: egreso 'Apoyo enviado' para quien envía; aviso '¿Ya lo recibiste?' para quien recibe", async () => {
    const s = await setup();
    const t = await sendSupport(db(), s.hijo, {
      recipientId: s.mama.id, amount: 150_000, date: TODAY, fromAccountId: s.bancoHijo.id, purpose: "general", note: "para el súper",
    });
    expect(t.status).toBe("enviado");
    expect(await bal(s.hijo, s.bancoHijo.id)).toBe(850_000);
    const [tx] = await listTransactions(db(), s.hijo);
    expect(tx).toMatchObject({ kind: "apoyo_enviado", amount: 150_000 });

    const inbox = await pendingToConfirm(db(), s.mama, TODAY);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ senderName: "Admin", amount: 150_000 });

    // Para el hijo cuenta como salida (no consumo); para mamá, como ingreso esperado.
    const hijoSept = await getMonthReport(db(), s.hijo, "2026-09", TODAY);
    expect(hijoSept.balance.spent).toMatchObject({ support: 150_000, variable: 0 });
    const mamaSept = await getMonthReport(db(), s.mama, "2026-09", TODAY);
    expect(mamaSept.balance.income.expected).toBe(150_000);
    // Configurable: si no quiere contarlos hasta confirmar.
    await updatePrefs(db(), s.mama, { apoyosPendientesCuentan: false });
    expect((await getMonthReport(db(), s.mama, "2026-09", TODAY)).balance.income.expected).toBe(0);
  });

  it("'Sí, ya lo recibí' → ingreso de apoyo en su cuenta; deshacer lo regresa a pendiente", async () => {
    const s = await setup();
    const t = await sendSupport(db(), s.hijo, {
      recipientId: s.mama.id, amount: 150_000, date: TODAY, fromAccountId: s.bancoHijo.id, purpose: "general", note: null,
    });
    await receiveSupport(db(), s.mama, t.id, { accountId: s.bancoMama.id, apply: { kind: "ninguno" } }, TODAY);
    expect(await bal(s.mama, s.bancoMama.id)).toBe(250_000);
    const report = await getMonthReport(db(), s.mama, "2026-09", TODAY);
    expect(report.balance.income).toMatchObject({ received: 150_000, expected: 0 });
    expect((await getSupport(db(), s.hijo, t.id)).status).toBe("recibido");
    await expect(receiveSupport(db(), s.mama, t.id, { accountId: s.bancoMama.id, apply: { kind: "ninguno" } }, TODAY)).rejects.toBeInstanceOf(AuthzError);

    await undoReceiveSupport(db(), s.mama, t.id);
    expect(await bal(s.mama, s.bancoMama.id)).toBe(100_000);
    expect((await getSupport(db(), s.mama, t.id)).status).toBe("enviado");
  });

  it("para pagar una deuda: se aplica a su tarjeta (baja la deuda, no cuenta doble)", async () => {
    const s = await setup();
    const t = await sendSupport(db(), s.hijo, {
      recipientId: s.mama.id, amount: 200_000, date: TODAY, fromAccountId: s.bancoHijo.id, purpose: "deuda", note: "para tu tarjeta",
    });
    await receiveSupport(db(), s.mama, t.id, { accountId: s.bancoMama.id, apply: { kind: "tarjeta", cardId: s.tarjetaMama.id } }, TODAY);
    expect(await bal(s.mama, s.tarjetaMama.id)).toBe(-100_000);
    expect(await bal(s.mama, s.bancoMama.id)).toBe(100_000);
    const r = await getMonthReport(db(), s.mama, "2026-09", TODAY);
    expect(r.balance.income.received).toBe(200_000);
    expect(r.balance.spent.total).toBe(0); // pagar la tarjeta no es gasto nuevo

    await undoReceiveSupport(db(), s.mama, t.id);
    expect(await bal(s.mama, s.tarjetaMama.id)).toBe(-300_000);
  });

  it("para pagar una deuda: la siguiente cuota o abono a capital de su préstamo", async () => {
    const s = await setup();
    const loan = await createLoan(db(), s.mama, {
      name: "Préstamo", informal: true, principal: 400_000, annualRateBp: 0, ivaPct: 0, periodicity: "mensual", nPayments: 4,
      firstPaymentDate: "2026-09-25", openingFee: null, catBp: null, payFromAccountId: s.bancoMama.id, paidBefore: 0, currentBalance: null,
    });
    const t1 = await sendSupport(db(), s.hijo, { recipientId: s.mama.id, amount: 100_000, date: TODAY, fromAccountId: s.bancoHijo.id, purpose: "deuda", note: null });
    await receiveSupport(db(), s.mama, t1.id, { accountId: s.bancoMama.id, apply: { kind: "cuota", loanId: loan.id } }, TODAY);
    expect((await getLoan(db(), s.mama, loan.id)).summary).toMatchObject({ paidCount: 1, remaining: 300_000 });

    const t2 = await sendSupport(db(), s.hijo, { recipientId: s.mama.id, amount: 100_000, date: TODAY, fromAccountId: s.bancoHijo.id, purpose: "deuda", note: null });
    await receiveSupport(db(), s.mama, t2.id, { accountId: s.bancoMama.id, apply: { kind: "abono", loanId: loan.id } }, TODAY);
    expect((await getLoan(db(), s.mama, loan.id)).summary.remaining).toBe(200_000);

    // Deshacer el primero ya no se puede (después hubo otro pago): primero el más reciente.
    await expect(undoReceiveSupport(db(), s.mama, t1.id)).rejects.toBeInstanceOf(AuthzError);
    await undoReceiveSupport(db(), s.mama, t2.id);
    await undoReceiveSupport(db(), s.mama, t1.id);
    expect((await getLoan(db(), s.mama, loan.id)).summary).toMatchObject({ paidCount: 0, remaining: 400_000 });
  });

  it("quien envía puede editar o cancelar mientras está pendiente (y deshacer la cancelación)", async () => {
    const s = await setup();
    const t = await sendSupport(db(), s.hijo, { recipientId: s.mama.id, amount: 100_000, date: TODAY, fromAccountId: s.bancoHijo.id, purpose: "general", note: null });
    await updateSupport(db(), s.hijo, t.id, { amount: 120_000, date: TODAY, note: "ajuste", fromAccountId: s.bancoHijo.id });
    expect(await bal(s.hijo, s.bancoHijo.id)).toBe(880_000);
    await setSupportCancelled(db(), s.hijo, t.id, true);
    expect(await bal(s.hijo, s.bancoHijo.id)).toBe(1_000_000);
    expect(await pendingToConfirm(db(), s.mama, TODAY)).toHaveLength(0);
    await setSupportCancelled(db(), s.hijo, t.id, false);
    expect(await pendingToConfirm(db(), s.mama, TODAY)).toHaveLength(1);

    await receiveSupport(db(), s.mama, t.id, { accountId: s.bancoMama.id, apply: { kind: "ninguno" } }, TODAY);
    await expect(updateSupport(db(), s.hijo, t.id, { amount: 1, date: TODAY, note: null, fromAccountId: s.bancoHijo.id })).rejects.toBeInstanceOf(AuthzError);
    await expect(setSupportCancelled(db(), s.hijo, t.id, true)).rejects.toBeInstanceOf(AuthzError);
    // Los movimientos del apoyo no se borran sueltos desde el historial.
    const [tx] = await listTransactions(db(), s.hijo);
    await expect(deleteTransaction(db(), s.hijo, tx.id)).rejects.toBeInstanceOf(AuthzError);
  });

  it("'Todavía no' deja de preguntar hasta mañana", async () => {
    const s = await setup();
    const t = await sendSupport(db(), s.hijo, { recipientId: s.mama.id, amount: 100_000, date: TODAY, fromAccountId: s.bancoHijo.id, purpose: "general", note: null });
    await snoozeSupport(db(), s.mama, t.id, TODAY);
    expect(await pendingToConfirm(db(), s.mama, TODAY)).toHaveLength(0);
    expect(await pendingToConfirm(db(), s.mama, "2026-09-21")).toHaveLength(1);
  });
});

describe("apoyos recurrentes", () => {
  it("cada quincena: se generan solos al llegar la fecha, sin duplicar, y los futuros cuentan en el mes", async () => {
    const s = await setup();
    const sched = await createSupportSchedule(db(), s.hijo, {
      recipientId: s.mama.id, amount: 50_000, date: "2026-09-15", fromAccountId: s.bancoHijo.id, purpose: "general", note: null, frequency: "quincenal",
    });
    await db().update(supportSchedules).set({ createdAt: new Date("2026-09-01T18:00:00Z") }).where(eq(supportSchedules.id, sched.id));

    // La mamá abre la app: se genera el del 15 (aunque el hijo no haya entrado).
    expect(await syncSupportSchedules(db(), s.mama, TODAY)).toBe(1);
    expect(await syncSupportSchedules(db(), s.hijo, TODAY)).toBe(0);
    expect(await pendingToConfirm(db(), s.mama, TODAY)).toHaveLength(1);
    expect(await bal(s.hijo, s.bancoHijo.id)).toBe(950_000);

    // El del 30 aún no llega: es compromiso para el hijo e ingreso esperado para mamá.
    const hijoR = await getMonthReport(db(), s.hijo, "2026-09", TODAY);
    expect(hijoR.balance.commitments).toBe(50_000);
    const mamaR = await getMonthReport(db(), s.mama, "2026-09", TODAY);
    expect(mamaR.balance.income.expected).toBe(100_000);
  });
});

describe("privacidad de los apoyos", () => {
  it("solo quien envía y quien recibe lo ven; nadie de fuera de la familia puede enviar ni confirmar", async () => {
    const s = await setup();
    const tercero = (await makeHousehold("Otra")).admin as Actor;
    const primo = await (async () => {
      // Otra persona de la MISMA familia (no participa en el apoyo).
      const fam2 = await makeHousehold("Familia");
      return fam2.member as Actor;
    })();
    const t = await sendSupport(db(), s.hijo, { recipientId: s.mama.id, amount: 100_000, date: TODAY, fromAccountId: s.bancoHijo.id, purpose: "general", note: "privado" });

    await expect(getSupport(db(), tercero, t.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(getSupport(db(), primo, t.id)).rejects.toBeInstanceOf(AuthzError);
    expect(await listSupports(db(), tercero)).toHaveLength(0);
    // Quien envía no puede confirmar por la otra persona; quien recibe no puede editar/cancelar.
    await expect(receiveSupport(db(), s.hijo, t.id, { accountId: s.bancoHijo.id, apply: { kind: "ninguno" } })).rejects.toBeInstanceOf(AuthzError);
    await expect(setSupportCancelled(db(), s.mama, t.id, true)).rejects.toBeInstanceOf(AuthzError);
    // Nadie puede enviar a alguien de otra familia, ni a sí mismo, ni desde la cuenta de otro.
    await expect(
      sendSupport(db(), s.hijo, { recipientId: tercero.id, amount: 1, date: TODAY, fromAccountId: s.bancoHijo.id, purpose: "general", note: null }),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(
      sendSupport(db(), s.hijo, { recipientId: s.hijo.id, amount: 1, date: TODAY, fromAccountId: s.bancoHijo.id, purpose: "general", note: null }),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(
      sendSupport(db(), s.hijo, { recipientId: s.mama.id, amount: 1, date: TODAY, fromAccountId: s.bancoMama.id, purpose: "general", note: null }),
    ).rejects.toBeInstanceOf(AuthzError);
    // Quien recibe no puede aplicarlo a una cuenta o tarjeta ajena.
    await expect(
      receiveSupport(db(), s.mama, t.id, { accountId: s.bancoHijo.id, apply: { kind: "ninguno" } }),
    ).rejects.toBeInstanceOf(AuthzError);
    // Enviar un apoyo NO expone las cuentas de la otra persona: las deudas solo las ve quien recibe.
    expect((await debtsForApply(db(), s.hijo)).cards).toHaveLength(0);
    expect((await debtsForApply(db(), s.mama)).cards.map((c) => c.name)).toEqual(["Liverpool"]);
    expect((await listAccounts(db(), s.hijo)).some((a) => a.id === s.bancoMama.id)).toBe(false);
  });
});
