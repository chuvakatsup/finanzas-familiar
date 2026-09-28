import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { listLoans } from "@/server/services/loans";
import { formatMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { Alert, ButtonLink, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Mis préstamos" };

export default async function LoansPage({ searchParams }: PageProps<"/prestamos">) {
  const actor = await requireUser();
  const { quitado } = await searchParams;
  const list = await listLoans(getDb(), actor);
  return (
    <>
      <PageTitle subtitle="Bancarios o de familia. Aquí ves cuánto debes y cuándo terminas.">Mis préstamos</PageTitle>
      {quitado && <Alert kind="ok">Préstamo quitado. Sus pagos registrados se conservan.</Alert>}
      {list.length === 0 ? (
        <p className="my-5 rounded-2xl bg-surface-2 p-5 text-lg">No tienes préstamos registrados.</p>
      ) : (
        <ul className="my-5 flex flex-col gap-3">
          {list.map(({ loan, summary: s }) => (
            <li key={loan.id}>
              <Link
                href={`/prestamos/${loan.id}`}
                className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 hover:bg-surface-2"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="wrap-break-word text-xl font-semibold">
                    <span aria-hidden="true">📄 </span>
                    {loan.name}
                  </span>
                  <span className="shrink-0 text-right text-base text-muted">
                    Debes
                    <span className="tabular block text-xl font-bold text-danger">{formatMoney(Math.max(0, s.remaining))}</span>
                  </span>
                </span>
                <span className="text-base text-muted">
                  {s.done ? "✅ Liquidado" : `Pago ${Math.min(s.paidCount + 1, s.totalCount)} de ${s.totalCount}`}
                  {loan.informal ? " · sin intereses" : ""}
                </span>
                {s.next && (
                  <span className="text-base">
                    Siguiente: <strong className="tabular">{formatMoney(s.next.payment)}</strong> el {formatDay(s.next.dueDate)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ButtonLink href="/prestamos/nuevo">
        <span aria-hidden="true">➕</span> Agregar préstamo
      </ButtonLink>
    </>
  );
}
