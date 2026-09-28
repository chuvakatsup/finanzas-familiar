import { describe, expect, it } from "vitest";
import {
  annualFeeTotal,
  dueDateAfter,
  firstDueForPurchase,
  lastStatementDate,
  previousStatementDate,
  statementSummary,
} from "./credit-card";

describe("fechas de la tarjeta", () => {
  it("último corte y el anterior", () => {
    expect(lastStatementDate(5, "2026-09-28")).toBe("2026-09-05");
    expect(lastStatementDate(5, "2026-09-04")).toBe("2026-08-05");
    expect(lastStatementDate(31, "2026-09-28")).toBe("2026-08-31");
    expect(lastStatementDate(31, "2026-09-30")).toBe("2026-09-30");
    expect(previousStatementDate(5, "2026-01-05")).toBe("2025-12-05");
  });
  it("día límite de pago después del corte", () => {
    expect(dueDateAfter("2026-09-05", 25)).toBe("2026-09-25");
    expect(dueDateAfter("2026-09-20", 10)).toBe("2026-10-10");
  });
  it("primera mensualidad de una compra: la del corte que la incluye", () => {
    // Corte 5, paga 25: compra el 3 → entra al corte del 5 → paga el 25 del mismo mes.
    expect(firstDueForPurchase("2026-09-03", 5, 25)).toBe("2026-09-25");
    // Compra el 10 → corte del 5 de octubre → paga 25 de octubre.
    expect(firstDueForPurchase("2026-09-10", 5, 25)).toBe("2026-10-25");
    // Corte 20, paga 10: compra el 15 → corte 20 sept → paga 10 oct.
    expect(firstDueForPurchase("2026-09-15", 20, 10)).toBe("2026-10-10");
    // Sin datos: un mes después.
    expect(firstDueForPurchase("2026-01-31", null, null)).toBe("2026-02-28");
  });
});

describe("estado de cuenta estimado", () => {
  it("pago mínimo Banxico: mayor de 1.5% del saldo o 1.25% del límite, más mensualidades MSI", () => {
    const s = statementSummary({
      statementDebt: 1_050_000, // $10,500 de los cuales $500 son una mensualidad MSI
      msiInStatement: 50_000,
      paidSinceStatement: 0,
      creditLimit: 3_000_000,
      annualRateBp: 4800,
    });
    // 1.5% de 10,000 = 150; 1.25% de 30,000 = 375 → 375 + 500 de MSI = 875
    expect(s.minimumPayment).toBe(87_500);
    expect(s.noInterestPaymentLeft).toBe(1_050_000);
    // Si solo paga el mínimo: (10,500 − 875) × 4%/mes = 385 + IVA 61.60 = 446.60
    expect(s.interestIfMinimum).toBe(44_660);
  });
  it("lo que ya se pagó después del corte se descuenta", () => {
    const s = statementSummary({
      statementDebt: 500_000, msiInStatement: 0, paidSinceStatement: 300_000, creditLimit: null, annualRateBp: null,
    });
    expect(s.noInterestPaymentLeft).toBe(200_000);
    expect(s.minimumPaymentLeft).toBe(0);
    expect(s.interestIfMinimum).toBeNull();
  });
  it("el mínimo nunca pasa del saldo", () => {
    const s = statementSummary({
      statementDebt: 10_000, msiInStatement: 0, paidSinceStatement: 0, creditLimit: 5_000_000, annualRateBp: null,
    });
    expect(s.minimumPayment).toBe(10_000);
  });
  it("anualidad con IVA", () => {
    expect(annualFeeTotal(90_000, true)).toBe(104_400);
    expect(annualFeeTotal(90_000, false)).toBe(90_000);
  });
});
