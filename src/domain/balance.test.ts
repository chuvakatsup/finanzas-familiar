import { describe, expect, it } from "vitest";
import {
  type BalanceInput,
  computeMonthBalance,
  daysLeftInMonth,
  spendingByCategory,
  trafficLight,
} from "./balance";

const base: BalanceInput = {
  month: "2026-09",
  today: "2026-09-21",
  txs: [],
  due: [],
  budget: null,
  warnPct: 10,
};

describe("balance del mes", () => {
  it("fórmula completa: ingresos − compromisos − gastos − variable esperado", () => {
    const b = computeMonthBalance({
      ...base,
      txs: [
        { kind: "ingreso", amount: 600_000, origin: "recurrente" }, // pensión 15 ya llegó
        { kind: "gasto", amount: 150_000, origin: "manual" }, // súper
        { kind: "gasto", amount: 40_000, origin: "recurrente" }, // teléfono confirmado
      ],
      due: [
        { kind: "ingreso", amount: 600_000, status: "pendiente" }, // pensión del 30
        { kind: "ingreso", amount: 600_000, status: "confirmado" }, // (la del 15, ya es movimiento)
        { kind: "pago", amount: 45_000, status: "pendiente" }, // luz
        { kind: "pago", amount: 40_000, status: "confirmado" }, // teléfono (ya es movimiento)
        { kind: "pago", amount: 99_999, status: "omitido" }, // no aplica: no cuenta
      ],
      budget: 400_000,
    });
    expect(b.income).toEqual({ received: 600_000, expected: 600_000, total: 1_200_000 });
    expect(b.commitments).toBe(45_000);
    expect(b.spent).toEqual({ total: 190_000, variable: 150_000, fixed: 40_000, support: 0 });
    expect(b.budgetLeft).toBe(250_000);
    expect(b.expectedVariable).toBe(250_000);
    expect(b.outgoings).toBe(190_000 + 45_000 + 250_000);
    expect(b.result).toBe(1_200_000 - 485_000);
    expect(b.status).toBe("verde");
    // Disponible = ingresos − gastos − compromisos (antes de apartar presupuesto)
    expect(b.available).toBe(965_000);
    // Quedan 10 días (21 al 30). Con presupuesto: min(disponible, restante) / días
    expect(b.daysLeft).toBe(10);
    expect(b.dailyAllowance).toBe(25_000);
  });

  it("sin doble conteo: pagar la tarjeta y corregir saldo no son gasto", () => {
    const b = computeMonthBalance({
      ...base,
      txs: [
        { kind: "gasto", amount: 50_000, origin: "manual" },
        { kind: "pago_tarjeta", amount: 50_000, origin: "manual" },
        { kind: "ajuste", amount: 10_000, origin: "manual" },
        { kind: "transferencia", amount: 20_000, origin: "manual" },
      ],
    });
    expect(b.spent.total).toBe(50_000);
  });

  it("rojo cuando falta dinero, con el monto de lo que se pasa", () => {
    const b = computeMonthBalance({
      ...base,
      txs: [{ kind: "ingreso", amount: 100_000, origin: "manual" }],
      due: [{ kind: "pago", amount: 330_000, status: "pendiente" }],
    });
    expect(b.result).toBe(-230_000);
    expect(b.status).toBe("rojo");
    expect(b.dailyAllowance).toBe(0);
  });

  it("amarillo cuando sobra poco (≤ 10% de los ingresos)", () => {
    const b = computeMonthBalance({
      ...base,
      txs: [
        { kind: "ingreso", amount: 1_000_000, origin: "manual" },
        { kind: "gasto", amount: 950_000, origin: "manual" },
      ],
    });
    expect(b.result).toBe(50_000);
    expect(b.status).toBe("amarillo");
  });

  it("sin datos no inventa un semáforo", () => {
    expect(computeMonthBalance(base).status).toBe("sin-datos");
  });

  it("mes pasado: no aparta presupuesto ni da promedio diario", () => {
    const b = computeMonthBalance({
      ...base,
      month: "2026-08",
      txs: [{ kind: "gasto", amount: 10_000, origin: "manual" }],
      budget: 400_000,
    });
    expect(b.position).toBe("pasado");
    expect(b.expectedVariable).toBe(0);
    expect(b.dailyAllowance).toBeNull();
  });

  it("mes futuro: aparta el presupuesto completo", () => {
    const b = computeMonthBalance({
      ...base,
      month: "2026-10",
      due: [{ kind: "ingreso", amount: 1_200_000, status: "pendiente" }],
      budget: 400_000,
    });
    expect(b.position).toBe("futuro");
    expect(b.expectedVariable).toBe(400_000);
    expect(b.result).toBe(800_000);
    expect(b.daysLeft).toBe(31);
  });

  it("apoyos enviados reducen lo que queda pero no son consumo", () => {
    const b = computeMonthBalance({
      ...base,
      txs: [
        { kind: "ingreso", amount: 500_000, origin: "manual" },
        { kind: "apoyo_enviado", amount: 150_000, origin: "apoyo" },
        { kind: "apoyo_recibido", amount: 20_000, origin: "apoyo" },
      ],
    });
    expect(b.spent).toMatchObject({ total: 150_000, support: 150_000, variable: 0 });
    expect(b.income.received).toBe(520_000);
    expect(b.result).toBe(370_000);
  });

  it("presupuesto ya rebasado: no aparta negativo", () => {
    const b = computeMonthBalance({
      ...base,
      txs: [
        { kind: "ingreso", amount: 1_000_000, origin: "manual" },
        { kind: "gasto", amount: 500_000, origin: "manual" },
      ],
      budget: 400_000,
    });
    expect(b.budgetLeft).toBe(0);
    expect(b.expectedVariable).toBe(0);
    expect(b.dailyAllowance).toBe(0);
  });
});

describe("semáforo con umbral configurable", () => {
  it("umbral 10% y 25%", () => {
    expect(trafficLight(100_001, 1_000_000, 10)).toBe("verde");
    expect(trafficLight(100_000, 1_000_000, 10)).toBe("amarillo");
    expect(trafficLight(200_000, 1_000_000, 25)).toBe("amarillo");
    expect(trafficLight(0, 0, 10)).toBe("amarillo");
    expect(trafficLight(-1, 1_000_000, 10)).toBe("rojo");
  });
});

describe("días que quedan", () => {
  it("cuenta hoy", () => {
    expect(daysLeftInMonth("2026-09", "2026-09-30")).toBe(1);
    expect(daysLeftInMonth("2026-09", "2026-09-01")).toBe(30);
    expect(daysLeftInMonth("2026-02", "2026-01-15")).toBe(28);
  });
});

describe("¿a dónde se va mi dinero?", () => {
  it("agrupa solo gastos, ordena de mayor a menor", () => {
    const r = spendingByCategory([
      { kind: "gasto", amount: 100, origin: "manual", categoryId: "comida" },
      { kind: "gasto", amount: 300, origin: "recurrente", categoryId: "casa" },
      { kind: "gasto", amount: 100, origin: "manual", categoryId: "comida" },
      { kind: "pago_tarjeta", amount: 9_999, origin: "manual", categoryId: null },
      { kind: "ingreso", amount: 9_999, origin: "manual", categoryId: "sueldo" },
    ]);
    expect(r).toEqual([
      { categoryId: "casa", total: 300, share: 0.6 },
      { categoryId: "comida", total: 200, share: 0.4 },
    ]);
  });
});
