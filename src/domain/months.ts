import type { IsoDate } from "./dates";

/** Mes como "YYYY-MM". */
export type YearMonth = string;

export function monthOf(date: IsoDate): YearMonth {
  return date.slice(0, 7);
}

/** Primer y último día del mes: ["2026-02-01", "2026-02-28"]. */
export function monthRange(ym: YearMonth): [IsoDate, IsoDate] {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`];
}

export function addMonths(ym: YearMonth, delta: number): YearMonth {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const monthFmt = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", month: "long", year: "numeric" });

/** "2026-09" → "septiembre de 2026" */
export function formatMonth(ym: YearMonth): string {
  return monthFmt.format(new Date(`${ym}-01T00:00:00Z`));
}

const dayFmt = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

/** "2026-09-28" → "lunes 28 de septiembre" */
export function formatDay(date: IsoDate): string {
  return dayFmt.format(new Date(`${date}T00:00:00Z`)).replace(",", "");
}
