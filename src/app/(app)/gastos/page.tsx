import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { getMonthReport } from "@/server/services/balance";
import { todayIso } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { monthOf } from "@/domain/months";
import { historyFiltersSchema } from "@/lib/schemas/finance";
import { MonthNav } from "@/components/month-nav";
import { ButtonLink, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "¿A dónde se va mi dinero?" };

/**
 * Barra horizontal simple. Se dibuja con SVG (atributo width) porque la CSP no permite estilos
 * en línea. `limitPct` marca el límite de la categoría si existe.
 */
function Bar({ pct, over, limitPct }: { pct: number; over: boolean; limitPct?: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <svg aria-hidden="true" viewBox="0 0 100 12" preserveAspectRatio="none" className="h-4 w-full">
      <rect x="0" y="0" width="100" height="12" rx="3" className="fill-surface-2" />
      <rect x="0" y="0" width={w} height="12" rx="3" className={over ? "fill-danger" : "fill-primary"} />
      {limitPct != null && limitPct <= 100 && (
        <rect x={Math.max(0, limitPct - 0.6)} y="0" width="1.2" height="12" className="fill-text" />
      )}
    </svg>
  );
}

export default async function WhereMoneyGoesPage({ searchParams }: PageProps<"/gastos">) {
  const actor = await requireUser();
  const today = todayIso();
  const { mes } = historyFiltersSchema.pick({ mes: true }).parse({ mes: (await searchParams).mes });
  const month = mes ?? monthOf(today);
  const report = await getMonthReport(getDb(), actor, month, today);
  const rows = report.byCategory;
  const total = report.balance.spent.total - report.balance.spent.support;
  // La barra más larga ocupa todo el ancho (escala relativa a la categoría mayor o a su límite).
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.total, r.limit ?? 0)));

  return (
    <>
      <PageTitle subtitle="Tus gastos del mes por categoría.">¿A dónde se va mi dinero?</PageTitle>
      <MonthNav month={month} hrefFor={(m) => `/gastos?mes=${m}`} />

      <p className="mb-4 text-xl">
        Gastaste <strong className="tabular text-danger">{formatMoney(total)}</strong> en total.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 p-5 text-lg text-muted">No hay gastos en este mes.</p>
      ) : (
        <ul className="mb-6 flex flex-col gap-3">
          {rows.map((r) => {
            const over = r.limit != null && r.total > r.limit;
            return (
              <li key={r.categoryId ?? "none"}>
                <Link
                  href={`/movimientos?mes=${month}${r.categoryId ? `&categoria=${r.categoryId}` : ""}`}
                  className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 hover:bg-surface-2"
                >
                  <span className="flex items-baseline gap-3">
                    <span aria-hidden="true" className="text-2xl">
                      {r.icon}
                    </span>
                    <span className="flex-1 wrap-break-word text-lg font-semibold">{r.name}</span>
                    <span className="tabular text-lg font-bold">{formatMoney(r.total)}</span>
                  </span>
                  <Bar
                    pct={(r.total / scale) * 100}
                    over={over}
                    limitPct={r.limit != null ? (r.limit / scale) * 100 : undefined}
                  />
                  <span className="flex flex-wrap justify-between gap-x-3 text-base text-muted">
                    <span>{Math.round(r.share * 100)}% de tus gastos</span>
                    {r.limit != null && (
                      <span className={over ? "font-semibold text-danger" : ""}>
                        {over ? (
                          <>
                            <span aria-hidden="true">⚠️ </span>Te pasaste {formatMoney(r.total - r.limit)} de tu
                            límite
                          </>
                        ) : (
                          `Límite ${formatMoney(r.limit)} · quedan ${formatMoney(r.limit - r.total)}`
                        )}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <ButtonLink href="/mas/presupuesto" variant="secondary">
        <span aria-hidden="true">🎯</span> Poner límites por categoría
      </ButtonLink>
    </>
  );
}
