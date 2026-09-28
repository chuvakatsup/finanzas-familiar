import type { DueItem } from "@/server/services/scheduled";
import { DueCard } from "./due-card";

type AccountOption = { id: string; name: string; kind: string };

/** Sección de tarjetas de pagos/ingresos programados. */
export function DueList({
  title,
  items,
  today,
  accounts,
  empty,
}: {
  title: string;
  items: DueItem[];
  today: string;
  accounts: AccountOption[];
  empty?: string;
}) {
  if (items.length === 0 && !empty) return null;
  return (
    <section aria-label={title} className="mb-6">
      <h2 className="mb-3 text-2xl font-bold">{title}</h2>
      {items.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 p-4 text-lg text-muted">{empty}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((d) => (
            <DueCard key={`${d.source}|${d.itemId}|${d.rowId ?? d.dueDate}`} due={d} today={today} accounts={accounts} />
          ))}
        </div>
      )}
    </section>
  );
}
