import { describe, expect, it } from "vitest";
import { accountBalance, creditSummary } from "./accounts";
import { transferKind, txDirection } from "./transactions";
import { groupByDate, summarize } from "./summary";
import { addMonths, formatMonth, monthRange } from "./months";
import { centsToInput } from "./money";
import { applyKey } from "@/components/money-keypad";

describe("saldo de cuenta", () => {
  const A = "a";
  const B = "b";
  it("inicial + entradas − salidas", () => {
    const moves = [
      { amount: 1000, fromAccountId: null, toAccountId: A }, // ingreso
      { amount: 300, fromAccountId: A, toAccountId: null }, // gasto
      { amount: 200, fromAccountId: A, toAccountId: B }, // transferencia
    ];
    expect(accountBalance(A, 500, moves)).toBe(1000);
    expect(accountBalance(B, 0, moves)).toBe(200);
  });

  it("tarjeta: gasto aumenta deuda y el pago la baja SIN contar doble", () => {
    const card = "tarjeta";
    const debit = "debito";
    const moves = [
      { amount: 50000, fromAccountId: card, toAccountId: null }, // compra de $500 con tarjeta
      { amount: 50000, fromAccountId: debit, toAccountId: card }, // pago de la tarjeta
    ];
    expect(accountBalance(card, 0, moves)).toBe(0);
    expect(accountBalance(debit, 100000, moves)).toBe(50000);
    // Solo la compra es gasto; el pago es "pago_tarjeta".
    const spent = summarize([
      { kind: "gasto", amount: 50000 },
      { kind: transferKind("credito"), amount: 50000 },
    ]).spent;
    expect(spent).toBe(50000);
  });
});

describe("creditSummary", () => {
  it("deuda, disponible y saldo a favor", () => {
    expect(creditSummary(-120000, 500000)).toEqual({ owed: 120000, available: 380000, inFavor: 0 });
    expect(creditSummary(5000, 500000)).toEqual({ owed: 0, available: 505000, inFavor: 5000 });
    expect(creditSummary(-100, null).available).toBeNull();
  });
});

describe("tipos de movimiento", () => {
  it("transferencia a tarjeta es pago de tarjeta", () => {
    expect(transferKind("credito")).toBe("pago_tarjeta");
    expect(transferKind("prestamo")).toBe("pago_prestamo");
    expect(transferKind("efectivo")).toBe("transferencia");
  });
  it("dirección visible", () => {
    expect(txDirection("gasto")).toBe("sale");
    expect(txDirection("ingreso")).toBe("entra");
    expect(txDirection("pago_tarjeta")).toBe("mueve");
  });
  it("resumen: correcciones y transferencias no son gasto ni ingreso", () => {
    expect(
      summarize([
        { kind: "gasto", amount: 100 },
        { kind: "ingreso", amount: 500 },
        { kind: "ajuste", amount: 999 },
        { kind: "transferencia", amount: 999 },
        { kind: "apoyo_enviado", amount: 50 },
      ]),
    ).toEqual({ spent: 100, received: 500, supportSent: 50 });
  });
});

describe("meses", () => {
  it("rango incluye años bisiestos", () => {
    expect(monthRange("2028-02")).toEqual(["2028-02-01", "2028-02-29"]);
    expect(monthRange("2026-02")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(monthRange("2026-12")).toEqual(["2026-12-01", "2026-12-31"]);
  });
  it("sumar meses cruza de año", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
  it("nombre del mes", () => {
    expect(formatMonth("2026-09")).toBe("septiembre de 2026");
  });
  it("agrupa por día conservando orden", () => {
    const g = groupByDate([{ date: "2026-09-28" }, { date: "2026-09-28" }, { date: "2026-09-27" }]);
    expect(g.map((x) => [x.date, x.rows.length])).toEqual([
      ["2026-09-28", 2],
      ["2026-09-27", 1],
    ]);
  });
});

describe("centsToInput", () => {
  it("sin flotantes", () => {
    expect(centsToInput(123450)).toBe("1234.50");
    expect(centsToInput(7)).toBe("0.07");
    expect(centsToInput(-100)).toBe("-1.00");
  });
});

describe("teclado de monto", () => {
  const type = (keys: string[]) =>
    keys.reduce((v, k) => applyKey(v, k as Parameters<typeof applyKey>[1]), "");
  it("escribe montos normales", () => {
    expect(type(["1", "5", "0"])).toBe("150");
    expect(type(["1", "5", ".", "5", "0"])).toBe("15.50");
  });
  it("máximo 2 decimales y un solo punto", () => {
    expect(type(["1", ".", "2", "3", "4"])).toBe("1.23");
    expect(type(["1", ".", ".", "5"])).toBe("1.5");
  });
  it("punto al inicio agrega 0 y no hay ceros a la izquierda", () => {
    expect(type([".", "5"])).toBe("0.5");
    expect(type(["0", "0", "7"])).toBe("7");
  });
  it("borrar", () => {
    expect(type(["1", "2", "⌫"])).toBe("1");
    expect(type(["⌫"])).toBe("");
  });
});
