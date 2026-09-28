import Link from "next/link";
import { addMonths, formatMonth, type YearMonth } from "@/domain/months";
import { capitalize } from "@/domain/dates";

/** "‹ Agosto | Septiembre 2026 | Octubre ›" con botones grandes. */
export function MonthNav({ month, hrefFor }: { month: YearMonth; hrefFor: (m: YearMonth) => string }) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const btn =
    "flex min-h-14 min-w-14 items-center justify-center rounded-2xl border-2 border-border bg-surface text-2xl font-bold";
  return (
    <nav aria-label="Cambiar de mes" className="mb-4 flex items-center gap-2">
      <Link href={hrefFor(prev)} className={btn} aria-label={`Mes anterior: ${formatMonth(prev)}`}>
        ‹
      </Link>
      <p className="flex-1 text-center text-lg font-bold leading-tight" aria-live="polite">
        {capitalize(formatMonth(month)).replace(" de ", " ")}
      </p>
      <Link href={hrefFor(next)} className={btn} aria-label={`Mes siguiente: ${formatMonth(next)}`}>
        ›
      </Link>
    </nav>
  );
}
