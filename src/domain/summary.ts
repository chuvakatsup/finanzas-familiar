import type { Cents } from "./money";
import type { TxKind } from "./transactions";

type Row = { kind: TxKind; amount: Cents };

/**
 * Totales de una lista de movimientos para mostrar arriba del historial.
 * Transferencias, pagos de tarjeta y correcciones NO son gasto ni ingreso.
 */
export function summarize(rows: readonly Row[]) {
  let spent = 0;
  let received = 0;
  let supportSent = 0;
  for (const r of rows) {
    if (r.kind === "gasto") spent += r.amount;
    else if (r.kind === "ingreso" || r.kind === "apoyo_recibido") received += r.amount;
    else if (r.kind === "apoyo_enviado") supportSent += r.amount;
  }
  return { spent, received, supportSent };
}

/** Agrupa filas (ya ordenadas por fecha desc) por día, conservando el orden. */
export function groupByDate<T extends { date: string }>(rows: readonly T[]): { date: string; rows: T[] }[] {
  const groups: { date: string; rows: T[] }[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last && last.date === row.date) last.rows.push(row);
    else groups.push({ date: row.date, rows: [row] });
  }
  return groups;
}
