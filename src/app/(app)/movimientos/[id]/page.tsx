import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { AuthzError } from "@/server/authz";
import { listAccounts } from "@/server/services/accounts";
import { listCategories } from "@/server/services/categories";
import { getTransaction } from "@/server/services/transactions";
import { sharedForTx } from "@/server/services/shared";
import { unshareExpenseAction } from "@/server/actions/shared";
import { formatRate } from "@/domain/amortization";
import { deleteTransactionAction, restoreTransactionAction } from "@/server/actions/finance";
import { capitalize } from "@/domain/dates";
import { centsToInput, formatMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { TX_KIND_INFO } from "@/domain/transactions";
import { ConfirmButton } from "@/components/confirm-button";
import { TxAmount } from "@/components/money";
import { Alert, ButtonLink, Card } from "@/components/ui";
import { EditTxForm } from "./edit-form";

export const metadata: Metadata = { title: "Movimiento" };

const EDITABLE = ["gasto", "ingreso", "transferencia", "pago_tarjeta"] as const;

export default async function TxPage({ params, searchParams }: PageProps<"/movimientos/[id]">) {
  const actor = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const tx = await getTransaction(db, actor, id).catch((e) => {
    if (e instanceof AuthzError) notFound();
    throw e;
  });
  const volver = typeof sp.volver === "string" && sp.volver.startsWith("/") && !sp.volver.startsWith("//") ? sp.volver : null;
  const backHref = volver ?? `/movimientos?mes=${tx.date.slice(0, 7)}`;
  const info = TX_KIND_INFO[tx.kind];
  const editable = tx.origin === "manual" && (EDITABLE as readonly string[]).includes(tx.kind) && !tx.deletedAt;

  // Cuentas/categorías activas, más las que ya usa el movimiento aunque estén archivadas.
  const [allAccounts, allCategories] = editable
    ? await Promise.all([
        listAccounts(db, actor, { includeArchived: true }),
        tx.kind === "gasto" || tx.kind === "ingreso"
          ? listCategories(db, actor, tx.kind, { includeArchived: true })
          : Promise.resolve([]),
      ])
    : [[], []];
  const accounts = allAccounts.filter(
    (a) => !a.archivedAt || a.id === tx.fromAccountId || a.id === tx.toAccountId,
  );
  const categories = allCategories.filter((c) => !c.archived || c.id === tx.categoryId);
  // Gastos propios capturados a mano: se pueden repartir con la familia.
  const shareable = tx.kind === "gasto" && tx.origin === "manual" && !tx.deletedAt;
  const parts = shareable ? await sharedForTx(db, actor, tx.id) : [];
  const someonePaid = parts.some((p) => p.status === "pagado" || p.status === "recibido");
  const ownPart = tx.amount - parts.filter((p) => p.status !== "rechazado").reduce((a, p) => a + p.amount, 0);
  const STATUS = {
    pendiente: "⏳ Te lo debe",
    pagado: "💬 Dice que ya te pagó",
    recibido: "✅ Ya te pagó",
    rechazado: "✖️ Dijo que no le toca",
  } as const;

  return (
    <>
      <p className="mb-3">
        <a href={backHref} className="inline-flex min-h-12 items-center text-lg font-semibold text-primary underline">
          ‹ Regresar
        </a>
      </p>
      {sp.restaurado && <Alert kind="ok">Listo, el movimiento se recuperó.</Alert>}
      {sp.compartido && <Alert kind="ok">Listo, el gasto quedó compartido. Ya les avisamos.</Alert>}
      {sp.sinReparto && <Alert kind="ok">Listo, el gasto ya no está compartido.</Alert>}
      {typeof sp.error === "string" && <Alert>{sp.error}</Alert>}

      <Card className="my-4">
        <p className="text-lg text-muted">
          <span aria-hidden="true">{tx.categoryIcon ?? info.icon} </span>
          {info.label}
          {tx.categoryName ? ` · ${tx.categoryName}` : ""}
        </p>
        <p className="mt-1">
          <TxAmount kind={tx.kind} amount={tx.amount} className="text-4xl" />
        </p>
        <p className="mt-2 text-lg">{capitalize(formatDay(tx.date))}</p>
        <p className="text-lg text-muted">
          {tx.fromAccountName && tx.toAccountName
            ? `${tx.fromAccountName} → ${tx.toAccountName}`
            : (tx.fromAccountName ?? tx.toAccountName)}
        </p>
        {tx.note && <p className="mt-2 text-lg">“{tx.note}”</p>}
        {tx.kind === "pago_tarjeta" && (
          <p className="mt-2 text-base text-muted">Un pago de tarjeta no cuenta como gasto nuevo.</p>
        )}
      </Card>

      {shareable && parts.length > 0 && (
        <section aria-labelledby="sec-reparto" className="mb-5 rounded-2xl border-2 border-primary bg-surface p-4">
          <h2 id="sec-reparto" className="text-xl font-bold">
            <span aria-hidden="true">👥 </span>Gasto compartido
          </h2>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {parts.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-3 py-2">
                <span>
                  <span className="block text-lg font-semibold">
                    {p.debtorName}
                    {p.percentBp != null ? ` (${formatRate(p.percentBp)})` : ""}
                  </span>
                  <span className="block text-base text-muted">{STATUS[p.status]}</span>
                </span>
                <span className="tabular shrink-0 text-lg font-bold">{formatMoney(p.amount)}</span>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-3 py-2">
              <span className="text-lg font-semibold">Tu parte (lo que te cuenta este mes)</span>
              <span className="tabular shrink-0 text-lg font-bold">{formatMoney(ownPart)}</span>
            </li>
          </ul>
          {!someonePaid && (
            <form action={unshareExpenseAction} className="mt-2">
              <input type="hidden" name="txId" value={tx.id} />
              <ConfirmButton
                look="link"
                title="¿Quitar el reparto?"
                message={<p>El gasto volverá a contar completo para ti y ya no le aparecerá a nadie más.</p>}
                confirmLabel="Sí, quitar"
                variant="secondary"
              >
                Quitar el reparto
              </ConfirmButton>
            </form>
          )}
        </section>
      )}
      {shareable && parts.length === 0 && (
        <div className="mb-5">
          <ButtonLink href={`/movimientos/${tx.id}/compartir`} variant="secondary">
            <span aria-hidden="true">👥</span> Compartir este gasto con mi familia
          </ButtonLink>
        </div>
      )}

      {tx.deletedAt ? (
        <form action={restoreTransactionAction}>
          <input type="hidden" name="id" value={tx.id} />
          <Alert kind="warn">Este movimiento está borrado.</Alert>
          <button type="submit" className="mt-3 min-h-14 w-full rounded-2xl bg-primary text-lg font-semibold text-on-primary">
            ↩️ Recuperarlo
          </button>
        </form>
      ) : (
        <>
          {editable && (
            <details className="mb-5 rounded-2xl border border-border bg-surface p-4">
              <summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">
                <span aria-hidden="true">✏️ </span>Cambiar datos
              </summary>
              <div className="mt-3">
                <EditTxForm
                  tx={{
                    id: tx.id,
                    kind: tx.kind as (typeof EDITABLE)[number],
                    amount: centsToInput(tx.amount),
                    date: tx.date,
                    note: tx.note ?? "",
                    categoryId: tx.categoryId,
                    accountId: tx.kind === "ingreso" ? tx.toAccountId : tx.fromAccountId,
                    fromAccountId: tx.fromAccountId,
                    toAccountId: tx.toAccountId,
                  }}
                  accounts={accounts.map(({ id, name, kind }) => ({ id, name, kind }))}
                  categories={categories.map(({ id, name, icon }) => ({ id, name, icon }))}
                />
              </div>
            </details>
          )}
          {tx.origin !== "manual" && (
            <Alert kind="warn">Este movimiento se creó automáticamente; se cambia desde donde se generó.</Alert>
          )}
          <form action={deleteTransactionAction} className="mt-4">
            <input type="hidden" name="id" value={tx.id} />
            <input type="hidden" name="back" value={volver?.startsWith("/movimientos") ? volver : `/movimientos?mes=${tx.date.slice(0, 7)}`} />
            <ConfirmButton
              title="¿Borrar este movimiento?"
              message={<p>Podrás deshacerlo justo después si te equivocaste.</p>}
              confirmLabel="Sí, borrar"
            >
              <span aria-hidden="true">🗑️</span> Borrar movimiento
            </ConfirmButton>
          </form>
          <div className="mt-3">
            <ButtonLink href={backHref} variant="secondary">
              Listo
            </ButtonLink>
          </div>
        </>
      )}
    </>
  );
}
