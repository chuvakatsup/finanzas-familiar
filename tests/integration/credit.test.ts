import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { AuthzError, type Actor } from "@/server/authz";
import { createAccount, getAccount, listAccounts } from "@/server/services/accounts";
import { getMonthReport } from "@/server/services/balance";
import { getAnnualFee, getCardStatement, setAnnualFee } from "@/server/services/cards";
import { listCategories } from "@/server/services/categories";
import {
  createLoan,
  getLoan,
  loanDueBetween,
  payLoanInstallment,
  prepayLoan,
  undoLastLoanPayment,
} from "@/server/services/loans";
import {
  cancelInstallmentPurchase,
  createInstallmentPurchase,
  getInstallmentPurchase,
  installmentsBetween,
} from "@/server/services/msi";
import { listDue } from "@/server/services/scheduled";
import { listAllUpcoming } from "@/server/services/upcoming";
import { createExpense, createTransfer, deleteTransaction } from "@/server/services/transactions";
import { makeHousehold, resetDb } from "../support/db";

beforeEach(resetDb);
afterAll(closeDb);

const db = () => getDb();
const none = { last4: null, creditLimit: null, statementDay: null, paymentDueDay: null };

async function setup() {
  const { member, admin } = await makeHousehold();
  const actor: Actor = member;
  const banco = await createAccount(db(), actor, { ...none, kind: "debito", name: "Banco", balance: 5_000_000 });
  const tarjeta = await createAccount(db(), actor, {
    ...none, kind: "credito", name: "Tarjeta", balance: 0, creditLimit: 5_000_000, statementDay: 5, paymentDueDay: 25, interestRateBp: 4800,
  });
  const cats = await listCategories(db(), actor, "gasto");
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  return { actor, other: admin as Actor, banco, tarjeta, cat };
}

const bal = async (a: Actor, id: string) => (await getAccount(db(), a, id)).balance;

describe("compras a meses", () => {
  it("MSI nueva: la tarjeta refleja el total, el mes solo la mensualidad", async () => {
    const s = await setup();
    const p = await createInstallmentPurchase(db(), s.actor, {
      cardAccountId: s.tarjeta.id, description: "Refrigerador", categoryId: s.cat("Casa"), principal: 1_200_000,
      months: 12, withInterest: false, annualRateBp: 0, ivaPct: 0, purchaseDate: "2026-09-03", firstDueDate: null, paidBefore: 0,
    });
    // Compra el 3, corte el 5 → primera mensualidad el 25 de septiembre.
    expect(p.firstDueDate).toBe("2026-09-25");
    expect(await bal(s.actor, s.tarjeta.id)).toBe(-1_200_000);

    const sept = await getMonthReport(db(), s.actor, "2026-09", "2026-09-28");
    expect(sept.balance.spent.installments).toBe(100_000); // solo 1 mensualidad, no los 12,000
    expect(sept.byCategory.find((c) => c.name === "Casa")?.total).toBe(100_000);
    const oct = await getMonthReport(db(), s.actor, "2026-10", "2026-09-28");
    expect(oct.balance.commitments).toBe(100_000);

    const view = await getInstallmentPurchase(db(), s.actor, p.id, "2026-09-28");
    expect(view.summary).toMatchObject({ paidCount: 1, remainingCount: 11, remainingAmount: 1_100_000 });
  });

  it("MSI que ya iba en el pago 8 de 12: solo lo restante entra a la tarjeta y no toca meses pasados", async () => {
    const s = await setup();
    const p = await createInstallmentPurchase(db(), s.actor, {
      cardAccountId: s.tarjeta.id, description: "Pantalla", categoryId: s.cat("Diversión"), principal: 1_200_000,
      months: 12, withInterest: false, annualRateBp: 0, ivaPct: 0, purchaseDate: "2026-01-20", firstDueDate: "2026-02-25", paidBefore: 7,
    });
    const view = await getInstallmentPurchase(db(), s.actor, p.id, "2026-09-01");
    expect(view.rows.filter((r) => r.status === "pagado_previo")).toHaveLength(7);
    expect(view.summary.remainingCount).toBe(5);
    expect(await bal(s.actor, s.tarjeta.id)).toBe(-500_000);
    // Las 7 anteriores no aparecen en el balance de meses pasados.
    expect(await installmentsBetween(db(), s.actor, "2026-01-01", "2026-08-31")).toHaveLength(0);
  });

  it("quitar una compra registrada por error saca su deuda y se puede volver a contar", async () => {
    const s = await setup();
    const p = await createInstallmentPurchase(db(), s.actor, {
      cardAccountId: s.tarjeta.id, description: "X", categoryId: s.cat("Casa"), principal: 300_000,
      months: 3, withInterest: false, annualRateBp: 0, ivaPct: 0, purchaseDate: "2026-09-01", firstDueDate: null, paidBefore: 0,
    });
    await cancelInstallmentPurchase(db(), s.actor, p.id, true);
    expect(await bal(s.actor, s.tarjeta.id)).toBe(0);
    expect(await installmentsBetween(db(), s.actor, "2026-01-01", "2027-12-31")).toHaveLength(0);
    await cancelInstallmentPurchase(db(), s.actor, p.id, false);
    expect(await bal(s.actor, s.tarjeta.id)).toBe(-300_000);
    // El movimiento de la compra no se puede borrar suelto desde el historial.
    await expect(deleteTransaction(db(), s.actor, p.transactionId!)).rejects.toBeInstanceOf(AuthzError);
  });
});

describe("estado de cuenta de la tarjeta", () => {
  it("saldo al corte sin mensualidades futuras, pago para no generar intereses y lo ya pagado", async () => {
    const s = await setup();
    await createExpense(db(), s.actor, { amount: 800_000, categoryId: s.cat("Súper"), accountId: s.tarjeta.id, date: "2026-08-20", note: null });
    await createInstallmentPurchase(db(), s.actor, {
      cardAccountId: s.tarjeta.id, description: "Lavadora", categoryId: s.cat("Casa"), principal: 600_000,
      months: 6, withInterest: false, annualRateBp: 0, ivaPct: 0, purchaseDate: "2026-08-10", firstDueDate: null, paidBefore: 0,
    });
    // Compra después del corte del 5 de sept: no entra en este estado de cuenta.
    await createExpense(db(), s.actor, { amount: 50_000, categoryId: s.cat("Comida"), accountId: s.tarjeta.id, date: "2026-09-10", note: null });

    const st = await getCardStatement(db(), s.actor, s.tarjeta.id, "2026-09-12");
    expect(st).not.toBeNull();
    expect(st!.statementDate).toBe("2026-09-05");
    expect(st!.dueDate).toBe("2026-09-25");
    // 8,000 del súper + 1 mensualidad de 1,000 (la lavadora entró al corte del 5 de sept)
    expect(st!.statementDebt).toBe(900_000);
    expect(st!.noInterestPaymentLeft).toBe(900_000);

    await createTransfer(db(), s.actor, { amount: 400_000, fromAccountId: s.banco.id, toAccountId: s.tarjeta.id, date: "2026-09-15", note: null });
    const after = await getCardStatement(db(), s.actor, s.tarjeta.id, "2026-09-16");
    expect(after!.noInterestPaymentLeft).toBe(500_000);
    expect(after!.minimumPaymentLeft).toBe(0);

    const up = await listAllUpcoming(db(), s.actor, 30, "2026-09-16");
    expect(up.upcoming.find((u) => u.source === "tarjeta")).toMatchObject({ amount: 500_000, dueDate: "2026-09-25" });
  });

  it("anualidad: se programa sola cada año con IVA y se puede quitar", async () => {
    const s = await setup();
    await setAnnualFee(db(), s.actor, s.tarjeta.id, { amount: 90_000, nextDate: "2026-11-15", withIva: true });
    const fee = await getAnnualFee(db(), s.actor, s.tarjeta.id, "2026-09-28");
    expect(fee).toMatchObject({ amount: 90_000, withIva: true, total: 104_400, nextDate: "2026-11-15" });
    const due = await listDue(db(), s.actor, "2026-11-01", "2027-11-30");
    expect(due.map((d) => d.dueDate)).toEqual(["2026-11-15", "2027-11-15"]);
    expect(due[0]).toMatchObject({ amount: 104_400, autoRegister: true });
    await setAnnualFee(db(), s.actor, s.tarjeta.id, null);
    expect(await getAnnualFee(db(), s.actor, s.tarjeta.id)).toBeNull();
    expect(await listDue(db(), s.actor, "2026-11-01", "2027-11-30")).toHaveLength(0);
  });
});

const loanBase = {
  name: "Banco Azteca",
  informal: false,
  principal: 10_000_000,
  annualRateBp: 2400,
  ivaPct: 16,
  periodicity: "mensual" as const,
  nPayments: 12,
  firstPaymentDate: "2026-09-10",
  openingFee: null,
  catBp: null,
  paidBefore: 0,
  currentBalance: null,
};

describe("préstamos", () => {
  it("alta: cuenta de préstamo con la deuda y tabla de 12 pagos", async () => {
    const s = await setup();
    const loan = await createLoan(db(), s.actor, { ...loanBase, payFromAccountId: s.banco.id });
    const { rows, summary } = await getLoan(db(), s.actor, loan.id);
    expect(rows).toHaveLength(12);
    expect(rows[0].payment).toBe(964_277);
    expect(await bal(s.actor, loan.accountId)).toBe(-10_000_000);
    expect(summary).toMatchObject({ remaining: 10_000_000, paidCount: 0, totalCount: 12, done: false });
    expect(summary.payoffDate).toBe("2027-08-10");
  });

  it("pagar la cuota: capital baja la deuda, interés+IVA es gasto; toda la cuota sale del mes", async () => {
    const s = await setup();
    const loan = await createLoan(db(), s.actor, { ...loanBase, payFromAccountId: s.banco.id });
    const { rows } = await getLoan(db(), s.actor, loan.id);
    await payLoanInstallment(db(), s.actor, loan.id, rows[0].id, {}, "2026-09-12");
    expect(await bal(s.actor, loan.accountId)).toBe(-10_000_000 + 732_277);
    expect(await bal(s.actor, s.banco.id)).toBe(5_000_000 - 964_277);

    const sept = await getMonthReport(db(), s.actor, "2026-09", "2026-09-12");
    expect(sept.balance.spent).toMatchObject({ debts: 732_277, fixed: 232_000 });
    expect(sept.balance.spent.total).toBe(964_277);
    // Octubre: la cuota pendiente es compromiso.
    const oct = await getMonthReport(db(), s.actor, "2026-10", "2026-09-12");
    expect(oct.balance.commitments).toBe(964_277);

    // Solo se puede pagar en orden; y el pago no se borra suelto desde el historial.
    await expect(payLoanInstallment(db(), s.actor, loan.id, rows[2].id, {}, "2026-09-12")).rejects.toBeInstanceOf(AuthzError);
    const paid = (await getLoan(db(), s.actor, loan.id)).rows[0];
    await expect(deleteTransaction(db(), s.actor, paid.capitalTxId!)).rejects.toBeInstanceOf(AuthzError);

    // Deshacer lo regresa todo.
    await undoLastLoanPayment(db(), s.actor, loan.id);
    expect(await bal(s.actor, loan.accountId)).toBe(-10_000_000);
    expect(await bal(s.actor, s.banco.id)).toBe(5_000_000);
  });

  it("abono a capital: 'reducir plazo' acaba antes; 'reducir cuota' baja la cuota; deshacer restaura", async () => {
    const s = await setup();
    const loan = await createLoan(db(), s.actor, { ...loanBase, payFromAccountId: s.banco.id });
    const before = await getLoan(db(), s.actor, loan.id);

    await prepayLoan(db(), s.actor, loan.id, { amount: 3_000_000, date: "2026-09-05", fromAccountId: s.banco.id, mode: "plazo" });
    const plazo = await getLoan(db(), s.actor, loan.id);
    expect(plazo.summary.remaining).toBe(7_000_000);
    expect(plazo.summary.totalCount).toBeLessThan(12);
    expect(plazo.rows.find((r) => r.kind === "cuota")!.payment).toBe(964_277);

    await undoLastLoanPayment(db(), s.actor, loan.id);
    const restored = await getLoan(db(), s.actor, loan.id);
    expect(restored.summary.totalCount).toBe(12);
    expect(restored.rows.map((r) => r.payment)).toEqual(before.rows.map((r) => r.payment));

    await prepayLoan(db(), s.actor, loan.id, { amount: 3_000_000, date: "2026-09-05", fromAccountId: s.banco.id, mode: "cuota" });
    const cuota = await getLoan(db(), s.actor, loan.id);
    expect(cuota.summary.totalCount).toBe(12);
    expect(cuota.rows.find((r) => r.kind === "cuota")!.payment).toBeLessThan(964_277);
    // No se puede abonar más de lo que se debe.
    await expect(
      prepayLoan(db(), s.actor, loan.id, { amount: 99_000_000, date: "2026-09-05", fromAccountId: s.banco.id, mode: "plazo" }),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("préstamo que ya iba en el pago 5, con saldo real del banco distinto", async () => {
    const s = await setup();
    const loan = await createLoan(db(), s.actor, {
      ...loanBase, firstPaymentDate: "2026-04-10", paidBefore: 4, currentBalance: 7_000_000, payFromAccountId: s.banco.id,
    });
    const { rows, summary } = await getLoan(db(), s.actor, loan.id);
    expect(rows.filter((r) => r.status === "pagado_previo")).toHaveLength(4);
    expect(summary.remaining).toBe(7_000_000);
    expect(summary.paidCount).toBe(4);
    expect(rows.filter((r) => r.status === "pendiente").at(-1)!.balanceAfter).toBe(0);
    expect(await bal(s.actor, loan.accountId)).toBe(-7_000_000);
    // Los pagos previos no cuentan en meses pasados.
    expect(await loanDueBetween(db(), s.actor, "2026-04-01", "2026-07-31")).toHaveLength(0);
  });

  it("préstamo informal sin intereses", async () => {
    const s = await setup();
    const loan = await createLoan(db(), s.actor, {
      ...loanBase, name: "Mi hermano", informal: true, principal: 1_000_000, nPayments: 4, payFromAccountId: s.banco.id,
    });
    const { rows, summary } = await getLoan(db(), s.actor, loan.id);
    expect(rows.map((r) => r.payment)).toEqual([250_000, 250_000, 250_000, 250_000]);
    expect(summary.interestPending).toBe(0);
  });
});

describe("aislamiento", () => {
  it("nadie ve ni toca compras a meses, tarjetas ni préstamos de otro", async () => {
    const s = await setup();
    const loan = await createLoan(db(), s.actor, { ...loanBase, payFromAccountId: s.banco.id });
    const p = await createInstallmentPurchase(db(), s.actor, {
      cardAccountId: s.tarjeta.id, description: "X", categoryId: s.cat("Casa"), principal: 300_000,
      months: 3, withInterest: false, annualRateBp: 0, ivaPct: 0, purchaseDate: "2026-09-01", firstDueDate: null, paidBefore: 0,
    });
    const { rows } = await getLoan(db(), s.actor, loan.id);
    const [otherCash] = await listAccounts(db(), s.other);
    const otherCats = await listCategories(db(), s.other, "gasto");

    await expect(getLoan(db(), s.other, loan.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(payLoanInstallment(db(), s.other, loan.id, rows[0].id)).rejects.toBeInstanceOf(AuthzError);
    await expect(prepayLoan(db(), s.other, loan.id, { amount: 1, date: "2026-09-01", fromAccountId: otherCash.id, mode: "plazo" })).rejects.toBeInstanceOf(AuthzError);
    await expect(undoLastLoanPayment(db(), s.other, loan.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(getInstallmentPurchase(db(), s.other, p.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(cancelInstallmentPurchase(db(), s.other, p.id, true)).rejects.toBeInstanceOf(AuthzError);
    await expect(getCardStatement(db(), s.other, s.tarjeta.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(setAnnualFee(db(), s.other, s.tarjeta.id, null)).rejects.toBeInstanceOf(AuthzError);
    // No puede registrar compras a meses en la tarjeta de otro, ni pagar su préstamo con la cuenta de otro.
    await expect(
      createInstallmentPurchase(db(), s.other, {
        cardAccountId: s.tarjeta.id, description: "Y", categoryId: otherCats[0].id, principal: 100,
        months: 2, withInterest: false, annualRateBp: 0, ivaPct: 0, purchaseDate: "2026-09-01", firstDueDate: null, paidBefore: 0,
      }),
    ).rejects.toBeInstanceOf(AuthzError);
    const own = await createLoan(db(), s.other, { ...loanBase, payFromAccountId: otherCash.id });
    const ownRows = (await getLoan(db(), s.other, own.id)).rows;
    await expect(payLoanInstallment(db(), s.other, own.id, ownRows[0].id, { fromAccountId: s.banco.id })).rejects.toBeInstanceOf(AuthzError);
    expect(await loanDueBetween(db(), s.other, "2026-01-01", "2030-01-01")).toHaveLength(12);
    const up = await listAllUpcoming(db(), s.other, 30, "2026-09-01");
    expect([...up.overdue, ...up.upcoming].every((u) => u.itemId !== loan.id && u.itemId !== s.tarjeta.id)).toBe(true);
  });
});
