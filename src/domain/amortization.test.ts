import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  fixedPayment,
  installmentPlan,
  parseRatePct,
  paymentDates,
  periodicRate,
  sumRows,
} from "./amortization";

describe("cuota fija (sistema francés)", () => {
  it("caso de referencia: $100,000 al 24% anual, 12 meses, sin IVA → $9,455.96", () => {
    // Calculadora de referencia: PMT(2%, 12, -100000) = 9,455.96
    expect(fixedPayment(10_000_000, periodicRate(2400, "mensual"), 0, 12)).toBe(945_596);
  });
  it("con IVA 16% sobre intereses la tasa efectiva es 2.32% mensual → $9,642.77", () => {
    // PMT(2.32%, 12, -100000) = 2320 / (1 − 1.0232^−12) = 9,642.77
    expect(fixedPayment(10_000_000, periodicRate(2400, "mensual"), 16, 12)).toBe(964_277);
  });
  it("tasa 0 (préstamo informal) reparte el capital", () => {
    expect(fixedPayment(1_000_000, 0, 0, 3)).toBe(333_334);
  });
});

describe("tabla de amortización", () => {
  const params = {
    principal: 10_000_000,
    annualRateBp: 2400,
    ivaPct: 16,
    periodicity: "mensual" as const,
    nPayments: 12,
    firstDate: "2026-01-31",
  };

  it("la suma de capital cuadra exacto y el saldo final es 0", () => {
    const rows = buildSchedule(params);
    expect(rows).toHaveLength(12);
    expect(sumRows(rows).capital).toBe(10_000_000);
    expect(rows.at(-1)!.balance).toBe(0);
  });

  it("primer renglón: interés = saldo × 2%, IVA = 16% del interés", () => {
    const [first] = buildSchedule(params);
    expect(first).toMatchObject({ number: 1, interest: 200_000, iva: 32_000, payment: 964_277, capital: 732_277 });
  });

  it("todos los pagos iguales salvo el último (que ajusta centavos)", () => {
    const rows = buildSchedule(params);
    expect(new Set(rows.slice(0, -1).map((r) => r.payment)).size).toBe(1);
    expect(Math.abs(rows.at(-1)!.payment - rows[0].payment)).toBeLessThan(100);
  });

  it("fin de mes se respeta (31 ene → 28 feb → 31 mar)", () => {
    const rows = buildSchedule(params);
    expect(rows.slice(0, 3).map((r) => r.dueDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("recalcular con cuota fija ('reducir plazo') termina antes", () => {
    const full = buildSchedule(params);
    const afterAbono = buildSchedule({
      ...params,
      principal: full[2].balance - 2_000_000, // abono extra de $20,000 tras el pago 3
      nPayments: 9,
      payment: full[0].payment,
      startNumber: 4,
      firstDate: full[3].dueDate,
    });
    expect(afterAbono.length).toBeLessThan(9);
    expect(afterAbono[0].number).toBe(4);
    expect(afterAbono.at(-1)!.balance).toBe(0);
  });

  it("recalcular con mismo plazo ('reducir cuota') baja la cuota", () => {
    const full = buildSchedule(params);
    const afterAbono = buildSchedule({
      ...params,
      principal: full[2].balance - 2_000_000,
      nPayments: 9,
      startNumber: 4,
      firstDate: full[3].dueDate,
    });
    expect(afterAbono).toHaveLength(9);
    expect(afterAbono[0].payment).toBeLessThan(full[0].payment);
  });

  it("quincenal y semanal", () => {
    expect(paymentDates("2026-09-15", "quincenal", 4)).toEqual(["2026-09-15", "2026-09-30", "2026-10-15", "2026-10-31"]);
    expect(paymentDates("2026-09-01", "quincenal", 3)).toEqual(["2026-09-01", "2026-09-16", "2026-10-01"]);
    expect(paymentDates("2026-09-04", "semanal", 3)).toEqual(["2026-09-04", "2026-09-11", "2026-09-18"]);
    const rows = buildSchedule({ ...params, periodicity: "quincenal", nPayments: 24, firstDate: "2026-09-15" });
    expect(sumRows(rows).capital).toBe(10_000_000);
  });

  it("préstamo informal sin intereses", () => {
    const rows = buildSchedule({ ...params, annualRateBp: 0, ivaPct: 0, nPayments: 3, principal: 1_000_000 });
    expect(rows.map((r) => r.payment)).toEqual([333_334, 333_334, 333_332]);
    expect(sumRows(rows).interest).toBe(0);
  });

  it("rechaza cuotas que no alcanzan ni para intereses", () => {
    expect(() => buildSchedule({ ...params, payment: 100, nPayments: 5 })).toThrow();
  });
});

describe("compras a meses", () => {
  it("MSI 12 meses: total ÷ 12, residuo al último, fechas mensuales", () => {
    const rows = installmentPlan({
      principal: 1_000_001, months: 12, withInterest: false, annualRateBp: 0, ivaPct: 0, firstDueDate: "2026-10-25",
    });
    expect(rows).toHaveLength(12);
    expect(rows[0].payment).toBe(83_333);
    expect(rows[11].payment).toBe(83_338);
    expect(rows[11].dueDate).toBe("2027-09-25");
    expect(sumRows(rows).payment).toBe(1_000_001);
  });
  it("meses con intereses usa la tabla francesa", () => {
    const rows = installmentPlan({
      principal: 1_200_000, months: 6, withInterest: true, annualRateBp: 3600, ivaPct: 16, firstDueDate: "2026-10-05",
    });
    expect(sumRows(rows).capital).toBe(1_200_000);
    expect(sumRows(rows).interest).toBeGreaterThan(0);
  });
});

describe("tasas", () => {
  it("parsea porcentajes", () => {
    expect(parseRatePct("24.5")).toBe(2450);
    expect(parseRatePct("36")).toBe(3600);
    expect(parseRatePct("0")).toBe(0);
    expect(parseRatePct("12,75%")).toBe(1275);
    expect(parseRatePct("abc")).toBeNull();
    expect(parseRatePct("1.234")).toBeNull();
  });
});
