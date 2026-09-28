import type { IsoDate } from "./dates";

/**
 * Motor de fechas para ingresos fijos y pagos recurrentes.
 * Todo trabaja con fechas calendario "YYYY-MM-DD" (sin horas ni zonas).
 */
export const FREQUENCIES = [
  "semanal",
  "catorcenal",
  "quincenal",
  "mensual",
  "bimestral",
  "anual",
  "unica",
] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_INFO: Record<Frequency, { label: string; help: string }> = {
  semanal: { label: "Cada semana", help: "El mismo día de cada semana" },
  catorcenal: { label: "Cada 2 semanas", help: "Cada 14 días (catorcena)" },
  quincenal: { label: "Cada quincena", help: "Dos veces al mes, por ejemplo el 15 y el último" },
  mensual: { label: "Cada mes", help: "El mismo día de cada mes" },
  bimestral: { label: "Cada 2 meses", help: "Por ejemplo el recibo de luz" },
  anual: { label: "Cada año", help: "Por ejemplo la anualidad de una tarjeta o un seguro" },
  unica: { label: "Una sola vez", help: "Un ingreso o pago que solo pasa una vez" },
};

/** Día 31 = "último día del mes" (se ajusta a 28/29/30). */
export const LAST_DAY = 31;

export type Schedule = {
  frequency: Frequency;
  /** Primera fecha posible (semanal/catorcenal/bimestral/anual/unica: es la fecha ancla). */
  startDate: IsoDate;
  endDate: IsoDate | null;
  /** mensual: día del mes; quincenal: primer día. */
  day1: number | null;
  /** quincenal: segundo día. */
  day2: number | null;
};

// ---------- utilidades de fecha (UTC, sin horas) ----------

function parts(d: IsoDate) {
  return { y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)), d: Number(d.slice(8, 10)) };
}

function iso(y: number, m: number, d: number): IsoDate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Fecha con el día ajustado al último del mes si hace falta (31 de febrero → 28/29). */
export function clampDate(y: number, m: number, day: number): IsoDate {
  return iso(y, m, Math.min(day, daysInMonth(y, m)));
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

function addMonthsTo(y: number, m: number, n: number) {
  const idx = y * 12 + (m - 1) + n;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

function monthsBetween(a: { y: number; m: number }, b: { y: number; m: number }) {
  return b.y * 12 + b.m - (a.y * 12 + a.m);
}

// ---------- ocurrencias ----------

/** Todas las fechas en las que toca, dentro de [from, to] (incluidos), ordenadas. */
export function occurrences(s: Schedule, from: IsoDate, to: IsoDate): IsoDate[] {
  const lo = from > s.startDate ? from : s.startDate;
  const hi = s.endDate && s.endDate < to ? s.endDate : to;
  if (lo > hi) return [];
  const out: IsoDate[] = [];
  const push = (d: IsoDate) => {
    if (d >= lo && d <= hi) out.push(d);
  };

  switch (s.frequency) {
    case "unica":
      push(s.startDate);
      break;

    case "semanal":
    case "catorcenal": {
      const step = s.frequency === "semanal" ? 7 : 14;
      // Primer múltiplo del paso que cae en o después de `lo`.
      const offset = Math.max(0, diffDays(lo, s.startDate));
      let d = addDays(s.startDate, Math.ceil(offset / step) * step);
      while (d <= hi) {
        push(d);
        d = addDays(d, step);
      }
      break;
    }

    case "mensual":
    case "quincenal": {
      const days =
        s.frequency === "mensual"
          ? [s.day1 ?? parts(s.startDate).d]
          : [s.day1 ?? 15, s.day2 ?? LAST_DAY];
      const start = parts(lo);
      const end = parts(hi);
      for (let k = 0; k <= monthsBetween(start, end); k++) {
        const { y, m } = addMonthsTo(start.y, start.m, k);
        const inMonth = [...new Set(days.map((day) => clampDate(y, m, day)))].sort();
        inMonth.forEach(push);
      }
      break;
    }

    case "bimestral":
    case "anual": {
      const step = s.frequency === "bimestral" ? 2 : 12;
      const anchor = parts(s.startDate);
      const day = s.day1 ?? anchor.d;
      const startK = Math.max(0, Math.floor(monthsBetween(anchor, parts(lo)) / step));
      for (let k = startK; ; k++) {
        const { y, m } = addMonthsTo(anchor.y, anchor.m, k * step);
        const d = clampDate(y, m, day);
        if (d > hi) break;
        push(d);
      }
      break;
    }
  }
  return out;
}

/** Siguiente fecha en o después de `onOrAfter` (null si ya terminó). Busca hasta ~2 años. */
export function nextOccurrence(s: Schedule, onOrAfter: IsoDate): IsoDate | null {
  return occurrences(s, onOrAfter, addDays(onOrAfter, 800))[0] ?? null;
}

/** ¿Esa fecha es realmente una ocurrencia del calendario? (para validar lo que llega del cliente) */
export function isOccurrence(s: Schedule, date: IsoDate): boolean {
  return occurrences(s, date, date).length === 1;
}

/** Texto amable: "Hoy", "Mañana", "En 3 días", "Hace 2 días". */
export function relativeDay(date: IsoDate, today: IsoDate): string {
  const n = diffDays(date, today);
  if (n === 0) return "Hoy";
  if (n === 1) return "Mañana";
  if (n === -1) return "Ayer";
  if (n > 1) return `En ${n} días`;
  return `Hace ${-n} días`;
}

/** Descripción corta del calendario: "Cada mes, el día 5". */
export function describeSchedule(s: Schedule): string {
  const dayText = (d: number | null) => (d == null ? "" : d >= LAST_DAY ? "el último día" : `el día ${d}`);
  switch (s.frequency) {
    case "mensual":
      return `Cada mes, ${dayText(s.day1 ?? parts(s.startDate).d)}`;
    case "quincenal": {
      const a = s.day1 ?? 15;
      const b = s.day2 ?? LAST_DAY;
      return `Cada quincena: ${a >= LAST_DAY ? "último" : a} y ${b >= LAST_DAY ? "último" : b}`;
    }
    default:
      return FREQUENCY_INFO[s.frequency].label;
  }
}
