import type { IsoDate } from "./dates";
import { type Cents, mulRound, splitEvenly } from "./money";
import { LAST_DAY, type Schedule, addDays, occurrences } from "./recurrence";

/**
 * Tablas de amortización (sistema francés = cuota fija).
 *
 * Práctica común en México: el IVA se cobra sobre el interés y la cuota que se paga es FIJA
 * (capital + interés + IVA). Para lograrlo se calcula la cuota con la tasa efectiva
 * r × (1 + IVA) y luego, en cada pago: interés = saldo × r, IVA = interés × %IVA,
 * capital = cuota − interés − IVA. El último pago absorbe el residuo de redondeo.
 *
 * Tasas en "puntos base" enteros para no guardar flotantes: 24.5% anual = 2450.
 */

export const PERIODICITIES = ["mensual", "quincenal", "semanal"] as const;
export type Periodicity = (typeof PERIODICITIES)[number];
export const PERIODS_PER_YEAR: Record<Periodicity, number> = { mensual: 12, quincenal: 24, semanal: 52 };
export const PERIODICITY_LABEL: Record<Periodicity, string> = {
  mensual: "Cada mes",
  quincenal: "Cada quincena",
  semanal: "Cada semana",
};

/** Métodos de cálculo. Hoy solo cuota fija; el diseño permite agregar otros. */
export const AMORTIZATION_METHODS = ["frances"] as const;
export type AmortizationMethod = (typeof AMORTIZATION_METHODS)[number];

export type AmortRow = {
  number: number;
  dueDate: IsoDate;
  payment: Cents;
  capital: Cents;
  interest: Cents;
  iva: Cents;
  balance: Cents;
};

/** 24.5% anual (2450 pb) mensual → 0.0204166… */
export function periodicRate(annualRateBp: number, periodicity: Periodicity): number {
  return annualRateBp / 10_000 / PERIODS_PER_YEAR[periodicity];
}

/** "24.5" → 2450. Acepta coma decimal. null si no es válido. */
export function parseRatePct(text: string): number | null {
  const t = text.trim().replace(",", ".").replace("%", "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [i, d = ""] = t.split(".");
  const bp = Number(i) * 100 + Number(d.padEnd(2, "0"));
  return bp <= 50_000 ? bp : null; // tope 500% anual
}

export function formatRate(bp: number): string {
  return `${(bp / 100).toLocaleString("es-MX", { maximumFractionDigits: 2 })}%`;
}

/** Cuota fija (capital + interés + IVA) para pagar `principal` en `n` pagos. */
export function fixedPayment(principal: Cents, r: number, ivaPct: number, n: number): Cents {
  if (n <= 0) throw new Error("El número de pagos debe ser mayor a cero");
  if (r === 0) return Math.ceil(principal / n);
  const re = r * (1 + ivaPct / 100);
  return mulRound(principal, re / (1 - Math.pow(1 + re, -n)));
}

/** Fechas de pago a partir de la primera, según la periodicidad. */
export function paymentDates(first: IsoDate, periodicity: Periodicity, count: number): IsoDate[] {
  if (count <= 0) return [];
  const day = Number(first.slice(8, 10));
  let s: Schedule;
  if (periodicity === "semanal") {
    s = { frequency: "semanal", startDate: first, endDate: null, day1: null, day2: null };
  } else if (periodicity === "quincenal") {
    const a = day <= 15 ? day : day - 15;
    const b = a + 15 >= 30 ? LAST_DAY : a + 15;
    s = { frequency: "quincenal", startDate: first, endDate: null, day1: a, day2: b };
  } else {
    s = { frequency: "mensual", startDate: first, endDate: null, day1: day >= 28 && day === lastDayOf(first) ? LAST_DAY : day, day2: null };
  }
  const span = periodicity === "semanal" ? 7 * count + 7 : 31 * (periodicity === "quincenal" ? Math.ceil(count / 2) : count) + 31;
  return occurrences(s, first, addDays(first, span)).slice(0, count);
}

function lastDayOf(d: IsoDate) {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export type ScheduleParams = {
  principal: Cents;
  annualRateBp: number;
  ivaPct: number;
  periodicity: Periodicity;
  /** Número de pagos (si no se da `payment`) o máximo de pagos. */
  nPayments: number;
  firstDate: IsoDate;
  /** Número del primer renglón (para recalcular a mitad del préstamo). */
  startNumber?: number;
  /** Cuota fija a respetar (recalcular "reduciendo plazo"). */
  payment?: Cents;
};

/**
 * Genera la tabla completa. Con `payment` se respeta esa cuota y el plazo se acorta
 * lo necesario (hasta `nPayments` como máximo, donde el último pago liquida todo).
 */
export function buildSchedule(p: ScheduleParams): AmortRow[] {
  if (p.principal <= 0) return [];
  const r = periodicRate(p.annualRateBp, p.periodicity);
  const payment = p.payment ?? fixedPayment(p.principal, r, p.ivaPct, p.nPayments);
  const dates = paymentDates(p.firstDate, p.periodicity, p.nPayments);
  const rows: AmortRow[] = [];
  let balance = p.principal;
  for (let k = 0; k < p.nPayments && balance > 0; k++) {
    const interest = mulRound(balance, r);
    const iva = mulRound(interest, p.ivaPct / 100);
    let capital = payment - interest - iva;
    if (capital <= 0 && k < p.nPayments - 1) {
      throw new Error("La cuota no alcanza ni para los intereses: el préstamo nunca se pagaría.");
    }
    const last = k === p.nPayments - 1 || capital >= balance;
    if (last) capital = balance;
    balance -= capital;
    rows.push({
      number: (p.startNumber ?? 1) + k,
      dueDate: dates[k],
      payment: capital + interest + iva,
      capital,
      interest,
      iva,
      balance,
    });
  }
  return rows;
}

/** Compras a meses: sin intereses = total ÷ meses (residuo al último); con intereses = tabla francesa. */
export function installmentPlan(p: {
  principal: Cents;
  months: number;
  withInterest: boolean;
  annualRateBp: number;
  ivaPct: number;
  firstDueDate: IsoDate;
}): AmortRow[] {
  if (p.withInterest && p.annualRateBp > 0) {
    return buildSchedule({
      principal: p.principal,
      annualRateBp: p.annualRateBp,
      ivaPct: p.ivaPct,
      periodicity: "mensual",
      nPayments: p.months,
      firstDate: p.firstDueDate,
    });
  }
  const dates = paymentDates(p.firstDueDate, "mensual", p.months);
  let balance = p.principal;
  return splitEvenly(p.principal, p.months).map((amount, i) => {
    balance -= amount;
    return { number: i + 1, dueDate: dates[i], payment: amount, capital: amount, interest: 0, iva: 0, balance };
  });
}

export function sumRows(rows: readonly AmortRow[]) {
  return rows.reduce(
    (acc, r) => ({
      payment: acc.payment + r.payment,
      capital: acc.capital + r.capital,
      interest: acc.interest + r.interest,
      iva: acc.iva + r.iva,
    }),
    { payment: 0, capital: 0, interest: 0, iva: 0 },
  );
}
