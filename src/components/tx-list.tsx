import Link from "next/link";
import type { TxRow } from "@/server/services/transactions";
import { capitalize } from "@/domain/dates";
import { formatDay } from "@/domain/months";
import { groupByDate } from "@/domain/summary";
import { TX_KIND_INFO } from "@/domain/transactions";
import { TxAmount } from "./money";

/** Los confirmados desde un pago/ingreso fijo guardan su nombre en la nota ("Netflix"). */
const fromSchedule = (t: TxRow) => t.origin === "recurrente" && !!t.note;

function title(t: TxRow) {
  if (fromSchedule(t)) return t.note!;
  if (t.categoryName) return t.categoryName;
  return TX_KIND_INFO[t.kind].label;
}

function subtitle(t: TxRow) {
  const parts: string[] = [];
  if (t.fromAccountName && t.toAccountName) parts.push(`${t.fromAccountName} → ${t.toAccountName}`);
  else parts.push(t.fromAccountName ?? t.toAccountName ?? "");
  if (fromSchedule(t)) parts.unshift(t.categoryName ?? "");
  else if (t.note) parts.push(t.note);
  return parts.filter(Boolean).join(" · ");
}

/** Lista de movimientos agrupada por día. Cada renglón abre el detalle. */
export function TxList({ rows, back }: { rows: TxRow[]; back?: string }) {
  if (rows.length === 0) {
    return <p className="rounded-2xl bg-surface-2 p-5 text-lg text-muted">No hay movimientos aquí todavía.</p>;
  }
  const qs = back ? `?volver=${encodeURIComponent(back)}` : "";
  return (
    <div className="flex flex-col gap-5">
      {groupByDate(rows).map((g) => (
        <section key={g.date} aria-label={formatDay(g.date)}>
          <h3 className="mb-2 text-lg font-semibold text-muted">{capitalize(formatDay(g.date))}</h3>
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {g.rows.map((t) => (
              <li key={t.id}>
                <Link href={`/movimientos/${t.id}${qs}`} className="flex min-h-16 items-center gap-3 p-3 hover:bg-surface-2">
                  <span aria-hidden="true" className="text-2xl">
                    {t.categoryIcon ?? TX_KIND_INFO[t.kind].icon}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="wrap-break-word text-lg font-semibold leading-snug">{title(t)}</span>
                    <span className="wrap-break-word text-base leading-snug text-muted">{subtitle(t)}</span>
                  </span>
                  <TxAmount kind={t.kind} amount={t.amount} className="shrink-0 self-start pt-0.5 text-lg" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
