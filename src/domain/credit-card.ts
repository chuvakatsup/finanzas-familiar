import type { IsoDate } from "./dates";
import { type Cents, mulRound } from "./money";
import { clampDate } from "./recurrence";

/**
 * Tarjeta de crédito: fechas de corte/pago y cifras del estado de cuenta.
 * Todo es ESTIMADO (el banco tiene la última palabra); la app lo dice en pantalla.
 */

export const IVA_PCT = 16;
/** Regla de Banxico para el pago mínimo. */
export const MIN_PCT_OF_BALANCE = 1.5;
export const MIN_PCT_OF_LIMIT = 1.25;

function ym(d: IsoDate) {
  return { y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) };
}
function shiftMonth(y: number, m: number, n: number) {
  const i = y * 12 + (m - 1) + n;
  return { y: Math.floor(i / 12), m: (i % 12) + 1 };
}

/** Fecha de corte más reciente en o antes de `today`. */
export function lastStatementDate(statementDay: number, today: IsoDate): IsoDate {
  const { y, m } = ym(today);
  const thisMonth = clampDate(y, m, statementDay);
  if (thisMonth <= today) return thisMonth;
  const p = shiftMonth(y, m, -1);
  return clampDate(p.y, p.m, statementDay);
}

export function previousStatementDate(statementDay: number, statement: IsoDate): IsoDate {
  const { y, m } = ym(statement);
  const p = shiftMonth(y, m, -1);
  return clampDate(p.y, p.m, statementDay);
}

/** Primer día límite de pago DESPUÉS de un corte (normalmente ~20 días después). */
export function dueDateAfter(statement: IsoDate, paymentDueDay: number): IsoDate {
  const { y, m } = ym(statement);
  const same = clampDate(y, m, paymentDueDay);
  if (same > statement) return same;
  const n = shiftMonth(y, m, 1);
  return clampDate(n.y, n.m, paymentDueDay);
}

/** Primera fecha de pago para una compra (a meses): el límite del corte donde cae la compra. */
export function firstDueForPurchase(purchase: IsoDate, statementDay: number | null, paymentDueDay: number | null): IsoDate {
  if (statementDay && paymentDueDay) {
    // El corte que incluye la compra es el primero en o después de la fecha de compra.
    const { y, m } = ym(purchase);
    let corte = clampDate(y, m, statementDay);
    if (corte < purchase) {
      const n = shiftMonth(y, m, 1);
      corte = clampDate(n.y, n.m, statementDay);
    }
    return dueDateAfter(corte, paymentDueDay);
  }
  // Sin datos de la tarjeta: un mes después de la compra.
  const { y, m } = ym(purchase);
  const n = shiftMonth(y, m, 1);
  return clampDate(n.y, n.m, Number(purchase.slice(8, 10)));
}

export type StatementInput = {
  /** Lo que se debía el día del corte, SIN contar mensualidades de meses futuros (positivo = deuda). */
  statementDebt: Cents;
  /** Parte de esa deuda que son mensualidades de compras a meses de este corte. */
  msiInStatement: Cents;
  /** Pagos a la tarjeta después del corte. */
  paidSinceStatement: Cents;
  creditLimit: Cents | null;
  /** Tasa anual de la tarjeta en puntos base (null = no la sabemos). */
  annualRateBp: number | null;
};

export type StatementSummary = {
  statementDebt: Cents;
  /** Pago para no generar intereses que AÚN falta cubrir. */
  noInterestPaymentLeft: Cents;
  /** Pago mínimo estimado (regla Banxico) que aún falta cubrir. */
  minimumPaymentLeft: Cents;
  minimumPayment: Cents;
  /** Intereses + IVA aproximados si solo se paga el mínimo (null si no hay tasa). */
  interestIfMinimum: Cents | null;
};

/**
 * Pago mínimo (Banxico): el mayor entre 1.5% del saldo (sin mensualidades MSI) e intereses/IVA
 * del periodo, y 1.25% del límite; más las mensualidades del periodo; nunca más que el saldo.
 * Aquí no conocemos intereses ya cobrados por el banco, así que se toman en 0 (estimado).
 */
export function statementSummary(s: StatementInput): StatementSummary {
  const regular = Math.max(0, s.statementDebt - s.msiInStatement);
  const byBalance = mulRound(regular, MIN_PCT_OF_BALANCE / 100);
  const byLimit = s.creditLimit ? mulRound(s.creditLimit, MIN_PCT_OF_LIMIT / 100) : 0;
  const minimum = Math.min(s.statementDebt, Math.max(byBalance, byLimit) + s.msiInStatement);
  const left = (x: Cents) => Math.max(0, x - s.paidSinceStatement);
  let interestIfMinimum: Cents | null = null;
  if (s.annualRateBp != null) {
    const unpaid = Math.max(0, s.statementDebt - minimum);
    const interest = mulRound(unpaid, s.annualRateBp / 10_000 / 12);
    interestIfMinimum = interest + mulRound(interest, IVA_PCT / 100);
  }
  return {
    statementDebt: s.statementDebt,
    noInterestPaymentLeft: left(s.statementDebt),
    minimumPaymentLeft: left(minimum),
    minimumPayment: minimum,
    interestIfMinimum,
  };
}

/** Anualidad con IVA opcional. */
export function annualFeeTotal(fee: Cents, withIva: boolean): Cents {
  return withIva ? fee + mulRound(fee, IVA_PCT / 100) : fee;
}
