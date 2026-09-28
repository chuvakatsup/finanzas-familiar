import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { listAccounts } from "@/server/services/accounts";
import { listCategories } from "@/server/services/categories";
import { listTransactions } from "@/server/services/transactions";
import { restoreTransactionAction } from "@/server/actions/finance";
import { todayIso } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { monthOf, monthRange } from "@/domain/months";
import { summarize } from "@/domain/summary";
import { historyFiltersSchema } from "@/lib/schemas/finance";
import { MonthNav } from "@/components/month-nav";
import { TxList } from "@/components/tx-list";
import { PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Mis movimientos" };

const selectCls = "min-h-14 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg";

export default async function HistoryPage({ searchParams }: PageProps<"/movimientos">) {
  const actor = await requireUser();
  const sp = await searchParams;
  const filters = historyFiltersSchema.parse({
    mes: sp.mes,
    cuenta: sp.cuenta || undefined,
    categoria: sp.categoria || undefined,
    q: sp.q || undefined,
  });
  const deletedId = typeof sp.borrado === "string" ? sp.borrado : null;
  const month = filters.mes ?? monthOf(todayIso());
  const [from, to] = monthRange(month);

  const db = getDb();
  const [rows, accounts, expenseCats, incomeCats] = await Promise.all([
    listTransactions(db, actor, {
      from,
      to,
      accountId: filters.cuenta,
      categoryId: filters.categoria,
      q: filters.q,
    }),
    listAccounts(db, actor, { includeArchived: true }),
    listCategories(db, actor, "gasto", { includeArchived: true }),
    listCategories(db, actor, "ingreso", { includeArchived: true }),
  ]);
  const totals = summarize(rows);
  const hasFilters = Boolean(filters.cuenta || filters.categoria || filters.q);

  const hrefFor = (m: string) => {
    const p = new URLSearchParams();
    p.set("mes", m);
    if (filters.cuenta) p.set("cuenta", filters.cuenta);
    if (filters.categoria) p.set("categoria", filters.categoria);
    if (filters.q) p.set("q", filters.q);
    return `/movimientos?${p}`;
  };

  return (
    <>
      <PageTitle>Mis movimientos</PageTitle>

      {deletedId && (
        <form
          action={restoreTransactionAction}
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-warn bg-warn-bg p-4 text-warn"
        >
          <input type="hidden" name="id" value={deletedId} />
          <p className="text-lg font-semibold">
            <span aria-hidden="true">🗑️ </span>Se borró el movimiento.
          </p>
          <button
            type="submit"
            className="min-h-12 rounded-xl border-2 border-warn bg-surface px-4 text-lg font-bold text-text"
          >
            ↩️ Deshacer
          </button>
        </form>
      )}

      <MonthNav month={month} hrefFor={hrefFor} />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-surface p-3">
          <p className="text-base text-muted">Gastaste</p>
          <p className="tabular text-2xl font-bold text-danger">{formatMoney(totals.spent)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-3">
          <p className="text-base text-muted">Te entró</p>
          <p className="tabular text-2xl font-bold text-ok">{formatMoney(totals.received)}</p>
        </div>
      </div>

      <details className="mb-5 rounded-2xl border border-border bg-surface p-4" open={hasFilters}>
        <summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">
          <span aria-hidden="true">🔎 </span>Buscar y filtrar {hasFilters && "(activos)"}
        </summary>
        <form method="get" action="/movimientos" className="mt-3 flex flex-col gap-4">
          <input type="hidden" name="mes" value={month} />
          <label className="flex flex-col gap-1 text-lg font-semibold">
            Buscar
            <input
              name="q"
              type="search"
              defaultValue={filters.q ?? ""}
              placeholder="Nota, categoría o monto"
              className={selectCls}
            />
          </label>
          <label className="flex flex-col gap-1 text-lg font-semibold">
            Cuenta
            <select name="cuenta" defaultValue={filters.cuenta ?? ""} className={selectCls}>
              <option value="">Todas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-lg font-semibold">
            Categoría
            <select name="categoria" defaultValue={filters.categoria ?? ""} className={selectCls}>
              <option value="">Todas</option>
              <optgroup label="Gastos">
                {expenseCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Ingresos">
                {incomeCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <button type="submit" className="min-h-14 rounded-2xl bg-primary text-lg font-semibold text-on-primary">
            Buscar
          </button>
          {hasFilters && (
            <Link
              href={`/movimientos?mes=${month}`}
              className="flex min-h-12 items-center justify-center text-lg font-semibold text-primary underline"
            >
              Quitar filtros
            </Link>
          )}
        </form>
      </details>

      <TxList rows={rows} />
    </>
  );
}
