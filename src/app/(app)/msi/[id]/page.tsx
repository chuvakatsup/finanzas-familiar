import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { AuthzError } from "@/server/authz";
import { getInstallmentPurchase } from "@/server/services/msi";
import { cancelMsiAction } from "@/server/actions/credit";
import { formatRate } from "@/domain/amortization";
import { capitalize, todayIso } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { ConfirmButton } from "@/components/confirm-button";
import { Alert, ButtonLink, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Compra a meses" };

const STATUS = {
  pagado_previo: { label: "Pagado antes", cls: "text-muted", icon: "☑️" },
  cubierta: { label: "Ya se cobró", cls: "text-ok", icon: "✅" },
  pendiente: { label: "Por pagar", cls: "text-text", icon: "⏳" },
} as const;

export default async function MsiPage({ params, searchParams }: PageProps<"/msi/[id]">) {
  const actor = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const p = await getInstallmentPurchase(getDb(), actor, id, todayIso()).catch((e) => {
    if (e instanceof AuthzError) notFound();
    throw e;
  });
  const s = p.summary;
  const current = Math.min(s.paidCount + 1, p.months);

  return (
    <>
      <p className="mb-3">
        <a href={`/cuentas/${p.cardAccountId}`} className="inline-flex min-h-12 items-center text-lg font-semibold text-primary underline">
          ‹ {p.cardName}
        </a>
      </p>
      <header className="mb-4">
        <h1 className="text-3xl font-bold leading-tight">
          <span aria-hidden="true">{p.categoryIcon ?? "🗓️"} </span>
          {p.description}
        </h1>
        <p className="text-lg text-muted">
          {p.months} meses {p.withInterest ? `con intereses (${formatRate(p.annualRateBp)} anual)` : "sin intereses"} ·
          Comprado el {formatDay(p.purchaseDate)}
        </p>
      </header>
      {sp.nueva && <Alert kind="ok">Compra guardada. La mensualidad se cuenta en cada mes.</Alert>}
      {p.cancelledAt && <Alert kind="warn">Esta compra está quitada: ya no cuenta en la tarjeta ni en tus meses.</Alert>}

      <Card className="my-4">
        <p className="text-lg text-muted">Vas en el pago</p>
        <p className="text-4xl font-extrabold">
          {current} de {p.months}
        </p>
        {s.remainingCount > 0 ? (
          <p className="mt-2 text-xl">
            Te faltan <strong>{s.remainingCount}</strong> mensualidades ·{" "}
            <strong className="tabular">{formatMoney(s.remainingAmount)}</strong> por pagar
          </p>
        ) : (
          <p className="mt-2 text-xl font-semibold text-ok">✅ Ya se cobraron todas las mensualidades</p>
        )}
        {s.next && (
          <p className="mt-1 text-lg text-muted">
            Siguiente: {formatMoney(s.next.payment)} el {formatDay(s.next.dueDate)}
          </p>
        )}
        <p className="mt-2 text-base text-muted">
          Total: {formatMoney(s.total)}
          {p.withInterest && ` (precio ${formatMoney(p.principal)} + intereses)`}
        </p>
      </Card>

      <h2 className="mb-3 text-2xl font-bold">Mensualidades</h2>
      <ol className="mb-6 flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {p.rows.map((r) => {
          const st = STATUS[r.status];
          return (
            <li key={r.number} className="flex items-center justify-between gap-3 p-3">
              <span className="flex flex-col">
                <span className="text-lg font-semibold">
                  Pago {r.number} de {p.months}
                </span>
                <span className="text-base text-muted">{capitalize(formatDay(r.dueDate))}</span>
              </span>
              <span className="flex flex-col items-end">
                <span className="tabular text-lg font-bold">{formatMoney(r.payment)}</span>
                <span className={`text-base ${st.cls}`}>
                  <span aria-hidden="true">{st.icon} </span>
                  {st.label}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      <form action={cancelMsiAction}>
        <input type="hidden" name="id" value={p.id} />
        <input type="hidden" name="cancelled" value={p.cancelledAt ? "0" : "1"} />
        {p.cancelledAt ? (
          <button type="submit" className="min-h-14 w-full rounded-2xl border-2 border-border bg-surface text-lg font-semibold">
            ↩️ Volver a contarla
          </button>
        ) : (
          <ConfirmButton
            title="¿Quitar esta compra a meses?"
            message={<p>Úsalo solo si la registraste por error. Su deuda sale de la tarjeta. Podrás volver a contarla.</p>}
            confirmLabel="Sí, quitar"
          >
            <span aria-hidden="true">🗑️</span> Quitar (la registré por error)
          </ConfirmButton>
        )}
      </form>
      <div className="mt-3">
        <ButtonLink href={`/cuentas/${p.cardAccountId}`} variant="secondary">
          Ver la tarjeta
        </ButtonLink>
      </div>
    </>
  );
}
