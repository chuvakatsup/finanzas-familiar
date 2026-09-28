import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { AuthzError } from "@/server/authz";
import { listAccounts } from "@/server/services/accounts";
import { getLoan } from "@/server/services/loans";

type LoanRow = Awaited<ReturnType<typeof getLoan>>["rows"][number];
import { archiveLoanAction } from "@/server/actions/credit";
import { PERIODICITY_LABEL, formatRate } from "@/domain/amortization";
import { capitalize, todayIso } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { ConfirmButton } from "@/components/confirm-button";
import { Alert, Card } from "@/components/ui";
import { LoanActions, PrepayForm } from "./loan-actions";

export const metadata: Metadata = { title: "Préstamo" };

const STATUS = {
  pagado_previo: { label: "Pagado antes", cls: "text-muted", icon: "☑️" },
  pagado: { label: "Pagado", cls: "text-ok", icon: "✅" },
  pendiente: { label: "Por pagar", cls: "text-text", icon: "⏳" },
} as const;

const VISIBLE = 6;

function RowList({ rows, informal }: { rows: LoanRow[]; informal: boolean }) {
  return (
    <ol className="mb-4 flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {rows.map((r) => {
        const st = STATUS[r.status];
        return (
          <li key={r.id} className={`flex flex-col gap-1 p-3 ${r.kind === "abono" ? "bg-ok-bg" : ""}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-lg font-semibold">
                {r.kind === "abono" ? "💪 Abono a capital" : `Pago ${r.number}`}
                <span className="block text-base font-normal text-muted">{capitalize(formatDay(r.dueDate))}</span>
              </span>
              <span className="text-right">
                <span className="tabular block text-lg font-bold">{formatMoney(r.payment)}</span>
                <span className={`text-base ${st.cls}`}>
                  <span aria-hidden="true">{st.icon} </span>
                  {st.label}
                </span>
              </span>
            </div>
            {r.kind === "cuota" && !informal && (
              <p className="text-base text-muted">
                Capital {formatMoney(r.capital)} · Interés {formatMoney(r.interest)}
                {r.iva > 0 && ` · IVA ${formatMoney(r.iva)}`} · Quedan {formatMoney(r.balanceAfter)}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default async function LoanPage({ params, searchParams }: PageProps<"/prestamos/[id]">) {
  const actor = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const today = todayIso();
  const data = await getLoan(db, actor, id).catch((e) => {
    if (e instanceof AuthzError) notFound();
    throw e;
  });
  const { loan, rows, summary: s } = data;
  const accounts = (await listAccounts(db, actor)).filter((a) => a.kind !== "prestamo" && a.kind !== "credito");
  const accountOptions = accounts.map(({ id: aid, name }) => ({ id: aid, name }));
  const hasPaidInApp = rows.some((r) => r.status === "pagado");
  const pendingRows = rows.filter((r) => r.status === "pendiente");
  const doneRows = rows.filter((r) => r.status !== "pendiente").reverse();

  return (
    <>
      <p className="mb-3">
        <Link href="/prestamos" className="inline-flex min-h-12 items-center text-lg font-semibold text-primary underline">
          ‹ Mis préstamos
        </Link>
      </p>
      <header className="mb-4">
        <h1 className="text-3xl font-bold leading-tight">
          <span aria-hidden="true">📄 </span>
          {loan.name}
        </h1>
        <p className="text-lg text-muted">
          {formatMoney(loan.principal)} · {loan.informal ? "sin intereses" : `${formatRate(loan.annualRateBp)} anual${loan.ivaPct ? " + IVA" : ""}`} ·{" "}
          {loan.nPayments} pagos · {PERIODICITY_LABEL[loan.periodicity].toLowerCase()}
        </p>
        {loan.catBp != null && <p className="text-base text-muted">CAT informativo: {formatRate(loan.catBp)}</p>}
      </header>
      {sp.nuevo && <Alert kind="ok">Préstamo guardado. Ya calculamos tu tabla de pagos.</Alert>}

      <Card className="my-4">
        <p className="text-lg text-muted">Debes</p>
        <p className="tabular text-4xl font-extrabold text-danger">{formatMoney(Math.max(0, s.remaining))}</p>
        <p className="mt-1 text-xl font-semibold">
          {s.done ? "✅ ¡Préstamo liquidado!" : `Pago ${Math.min(s.paidCount + 1, s.totalCount)} de ${s.totalCount}`}
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-1 text-lg">
          <div className="flex justify-between gap-3">
            <dt>Ya pagaste</dt>
            <dd className="tabular font-semibold">{formatMoney(s.totalPaid)}</dd>
          </div>
          {!loan.informal && (
            <>
              <div className="flex justify-between gap-3">
                <dt>Intereses pagados</dt>
                <dd className="tabular">{formatMoney(s.interestPaid)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Intereses por pagar</dt>
                <dd className="tabular">{formatMoney(s.interestPending)}</dd>
              </div>
            </>
          )}
          {s.payoffDate && (
            <div className="flex justify-between gap-3">
              <dt>Terminas de pagar</dt>
              <dd>{formatDay(s.payoffDate)}</dd>
            </div>
          )}
        </dl>
      </Card>

      {!loan.archivedAt && (
        <LoanActions
          loanId={loan.id}
          next={s.next ? { id: s.next.id, number: s.next.number, payment: s.next.payment, dueDate: s.next.dueDate, capital: s.next.capital, interest: s.next.interest + s.next.iva } : null}
          total={s.totalCount}
          today={today}
          accounts={accountOptions}
          defaultAccountId={loan.payFromAccountId}
          canUndo={hasPaidInApp}
        />
      )}

      {!loan.archivedAt && !s.done && (
        <details className="mb-6 rounded-2xl border border-border bg-surface p-4">
          <summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">
            <span aria-hidden="true">💪 </span>Abonar a capital (pago extra)
          </summary>
          <PrepayForm loanId={loan.id} today={today} accounts={accountOptions} defaultAccountId={loan.payFromAccountId} max={s.remaining} />
        </details>
      )}

      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-2xl font-bold">Tabla de pagos</h2>
        <a href={`/api/export/prestamo/${loan.id}`} download className="min-h-12 text-base font-semibold text-primary underline">
          ⬇️ Descargar
        </a>
      </div>
      {/* A 360px una tabla de 36 renglones es inmanejable: lo próximo a la vista, lo demás plegado. */}
      {pendingRows.length > 0 && <RowList rows={pendingRows.slice(0, VISIBLE)} informal={loan.informal} />}
      {pendingRows.length > VISIBLE && (
        <details className="mb-4 rounded-2xl border border-border bg-surface p-4">
          <summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">
            Ver los otros {pendingRows.length - VISIBLE} pagos que faltan
          </summary>
          <div className="mt-3">
            <RowList rows={pendingRows.slice(VISIBLE)} informal={loan.informal} />
          </div>
        </details>
      )}
      {doneRows.length > 0 && (
        <details className="mb-6 rounded-2xl border border-border bg-surface p-4">
          <summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">Pagos ya hechos ({doneRows.length})</summary>
          <div className="mt-3">
            <RowList rows={doneRows} informal={loan.informal} />
          </div>
        </details>
      )}

      <form action={archiveLoanAction}>
        <input type="hidden" name="id" value={loan.id} />
        <input type="hidden" name="archived" value={loan.archivedAt ? "0" : "1"} />
        {loan.archivedAt ? (
          <button type="submit" className="min-h-14 w-full rounded-2xl border-2 border-border bg-surface text-lg font-semibold">
            Volver a mostrar este préstamo
          </button>
        ) : (
          <ConfirmButton
            title="¿Quitar este préstamo?"
            message={<p>Dejará de aparecer en tus pagos y en tu balance. Lo que ya registraste se conserva.</p>}
            confirmLabel="Sí, quitar"
            variant="secondary"
          >
            <span aria-hidden="true">🗄️</span> Quitar préstamo
          </ConfirmButton>
        )}
      </form>
    </>
  );
}
