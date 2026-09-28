import type { IsoDate } from "./dates";
import type { Cents } from "./money";
import { type YearMonth, monthOf, monthRange } from "./months";
import { diffDays } from "./recurrence";
import type { TxKind, TxOrigin } from "./transactions";

/**
 * EL CORAZÓN DE LA APP: ¿me alcanza este mes?
 *
 *   Ingresos del mes (registrados + fijos que aún faltan)
 * − Compromisos (pagos fijos que aún faltan este mes)
 * − Gastos ya hechos (efectivo, débito y tarjeta; el pago de la tarjeta NO cuenta: es transferencia)
 * − Gasto variable que falta según el presupuesto (si hay)
 * = Te sobra / te falta
 *
 * Sin doble conteo: un pago fijo confirmado ya es un gasto real y deja de ser "pendiente".
 */

export type BalanceTx = { kind: TxKind; amount: Cents; origin: TxOrigin };
export type BalanceDue = { kind: "ingreso" | "pago"; amount: Cents; status: "pendiente" | "confirmado" | "omitido" };

export type TrafficLight = "verde" | "amarillo" | "rojo" | "sin-datos";
export type MonthPosition = "pasado" | "actual" | "futuro";

export type BalanceInput = {
  month: YearMonth;
  today: IsoDate;
  /** Movimientos del mes (sin borrados). */
  txs: readonly BalanceTx[];
  /** Fechas de ingresos/pagos programados que caen en el mes. */
  due: readonly BalanceDue[];
  /** Presupuesto mensual de gasto variable (null = sin presupuesto). */
  budget: Cents | null;
  /** Umbral del amarillo en % de los ingresos (10 = 10%). */
  warnPct: number;
};

export type MonthBalance = {
  position: MonthPosition;
  income: { received: Cents; expected: Cents; total: Cents };
  commitments: Cents;
  spent: { total: Cents; variable: Cents; fixed: Cents; support: Cents };
  /** Lo que se aparta para gasto variable del resto del mes (según presupuesto). */
  expectedVariable: Cents;
  /** Gastos + compromisos + variable esperado (la cifra de en medio del inicio). */
  outgoings: Cents;
  /** Te sobra (+) o te falta (−). */
  result: Cents;
  status: TrafficLight;
  /** Dinero del mes que queda para gastar hasta fin de mes (antes de apartar el presupuesto). */
  available: Cents;
  daysLeft: number;
  /** "Puedes gastar $X al día" (null si el mes ya pasó o no hay de dónde). */
  dailyAllowance: Cents | null;
  budget: Cents | null;
  budgetLeft: Cents | null;
};

export function monthPosition(month: YearMonth, today: IsoDate): MonthPosition {
  const current = monthOf(today);
  if (month < current) return "pasado";
  if (month > current) return "futuro";
  return "actual";
}

/** Días que quedan en el mes contando hoy. */
export function daysLeftInMonth(month: YearMonth, today: IsoDate): number {
  const [first, last] = monthRange(month);
  const pos = monthPosition(month, today);
  if (pos === "pasado") return 0;
  if (pos === "futuro") return diffDays(last, first) + 1;
  return diffDays(last, today) + 1;
}

/** Gasto "variable" = el que la persona registra a mano (no los pagos fijos, MSI ni préstamos). */
export function isVariableSpend(tx: BalanceTx) {
  return tx.kind === "gasto" && tx.origin === "manual";
}

export function computeMonthBalance(input: BalanceInput): MonthBalance {
  const position = monthPosition(input.month, input.today);

  let received = 0;
  let spentTotal = 0;
  let variable = 0;
  let support = 0;
  for (const tx of input.txs) {
    if (tx.kind === "ingreso" || tx.kind === "apoyo_recibido") received += tx.amount;
    if (tx.kind === "gasto") {
      spentTotal += tx.amount;
      if (isVariableSpend(tx)) variable += tx.amount;
    }
    if (tx.kind === "apoyo_enviado") {
      spentTotal += tx.amount;
      support += tx.amount;
    }
  }

  let expectedIncome = 0;
  let commitments = 0;
  for (const d of input.due) {
    if (d.status !== "pendiente") continue;
    if (d.kind === "ingreso") expectedIncome += d.amount;
    else commitments += d.amount;
  }

  const budgetLeft = input.budget == null ? null : Math.max(0, input.budget - variable);
  const expectedVariable =
    budgetLeft == null || position === "pasado" ? 0 : position === "futuro" ? input.budget! : budgetLeft;

  const incomeTotal = received + expectedIncome;
  const outgoings = spentTotal + commitments + expectedVariable;
  const result = incomeTotal - outgoings;
  const available = incomeTotal - spentTotal - commitments;
  const daysLeft = daysLeftInMonth(input.month, input.today);

  let dailyAllowance: Cents | null = null;
  if (daysLeft > 0) {
    const pool = budgetLeft != null && position !== "futuro" ? Math.min(available, budgetLeft) : available;
    dailyAllowance = pool > 0 ? Math.floor(pool / daysLeft) : 0;
  }

  const hasData = input.txs.length > 0 || input.due.length > 0 || input.budget != null;

  return {
    position,
    income: { received, expected: expectedIncome, total: incomeTotal },
    commitments,
    spent: { total: spentTotal, variable, fixed: spentTotal - variable - support, support },
    expectedVariable,
    outgoings,
    result,
    status: hasData ? trafficLight(result, incomeTotal, input.warnPct) : "sin-datos",
    available,
    daysLeft,
    dailyAllowance,
    budget: input.budget,
    budgetLeft,
  };
}

/** Verde: sobra más del X% de los ingresos. Amarillo: sobra entre 0 y X%. Rojo: falta. */
export function trafficLight(result: Cents, income: Cents, warnPct: number): Exclude<TrafficLight, "sin-datos"> {
  if (result < 0) return "rojo";
  if (income <= 0) return result > 0 ? "verde" : "amarillo";
  return result * 100 > income * warnPct ? "verde" : "amarillo";
}

export type CategorySpend = { categoryId: string | null; total: Cents; share: number };

/** "¿A dónde se va mi dinero?": gastos del mes por categoría, de mayor a menor. */
export function spendingByCategory(txs: readonly (BalanceTx & { categoryId: string | null })[]): CategorySpend[] {
  const map = new Map<string | null, Cents>();
  let total = 0;
  for (const tx of txs) {
    if (tx.kind !== "gasto") continue;
    map.set(tx.categoryId, (map.get(tx.categoryId) ?? 0) + tx.amount);
    total += tx.amount;
  }
  return [...map.entries()]
    .map(([categoryId, t]) => ({ categoryId, total: t, share: total > 0 ? t / total : 0 }))
    .sort((a, b) => b.total - a.total);
}
