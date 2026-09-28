import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { AuthzError } from "@/server/authz";
import { getAccount } from "@/server/services/accounts";
import { listTransactions } from "@/server/services/transactions";
import { setAccountArchivedAction } from "@/server/actions/finance";
import { ACCOUNT_KIND_INFO, creditSummary } from "@/domain/accounts";
import { formatMoney } from "@/domain/money";
import { ConfirmButton } from "@/components/confirm-button";
import { TxList } from "@/components/tx-list";
import { Alert, ButtonLink, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Cuenta" };

export default async function AccountPage({ params, searchParams }: PageProps<"/cuentas/[id]">) {
  const actor = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const account = await getAccount(db, actor, id).catch((e) => {
    if (e instanceof AuthzError) notFound();
    throw e;
  });
  const rows = await listTransactions(db, actor, { accountId: id, limit: 30 });
  const info = ACCOUNT_KIND_INFO[account.kind];
  const credit = account.kind === "credito" ? creditSummary(account.balance, account.creditLimit) : null;

  return (
    <>
      <header className="mb-5 flex items-center gap-3">
        <span aria-hidden="true" className="text-4xl">
          {info.icon}
        </span>
        <div>
          <h1 className="text-3xl font-bold leading-tight">{account.name}</h1>
          <p className="text-lg text-muted">
            {info.label}
            {account.last4 ? ` · termina en ${account.last4}` : ""}
            {account.archivedAt ? " · archivada" : ""}
          </p>
        </div>
      </header>

      {sp.nueva && <Alert kind="ok">Cuenta agregada.</Alert>}
      {sp.guardado && <Alert kind="ok">Cambios guardados.</Alert>}
      {sp.corregido && <Alert kind="ok">Saldo corregido.</Alert>}

      <Card className="my-5">
        {credit ? (
          <>
            <p className="text-lg text-muted">Debes</p>
            <p className={`tabular text-4xl font-bold ${credit.owed > 0 ? "text-danger" : ""}`}>
              {formatMoney(credit.owed)}
            </p>
            {credit.inFavor > 0 && (
              <p className="mt-1 text-lg text-ok">Tienes {formatMoney(credit.inFavor)} a favor.</p>
            )}
            {credit.available != null && (
              <p className="mt-2 text-lg">
                Te quedan <strong className="tabular">{formatMoney(credit.available)}</strong> de{" "}
                <span className="tabular">{formatMoney(account.creditLimit!)}</span> para gastar.
              </p>
            )}
            {(account.statementDay || account.paymentDueDay) && (
              <p className="mt-2 text-lg text-muted">
                {account.statementDay ? `Corte: día ${account.statementDay}` : ""}
                {account.statementDay && account.paymentDueDay ? " · " : ""}
                {account.paymentDueDay ? `Pagar antes del día ${account.paymentDueDay}` : ""}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-lg text-muted">Tienes</p>
            <p className={`tabular text-4xl font-bold ${account.balance < 0 ? "text-danger" : ""}`}>
              {formatMoney(account.balance)}
            </p>
          </>
        )}
      </Card>

      {!account.archivedAt && (
        <div className="mb-6 flex flex-col gap-3">
          {credit && (
            <ButtonLink href={`/registrar/transferencia?a=${account.id}`}>
              <span aria-hidden="true">💳</span> Registrar pago de esta tarjeta
            </ButtonLink>
          )}
          <ButtonLink href={`/cuentas/${account.id}/saldo`} variant="secondary">
            <span aria-hidden="true">✏️</span> {credit ? "Corregir lo que debo" : "Corregir saldo"}
          </ButtonLink>
          <ButtonLink href={`/cuentas/${account.id}/editar`} variant="secondary">
            <span aria-hidden="true">⚙️</span> Editar datos
          </ButtonLink>
        </div>
      )}

      <h2 className="mb-3 text-2xl font-bold">Últimos movimientos</h2>
      <TxList rows={rows} back={`/cuentas/${account.id}`} />
      {rows.length >= 30 && (
        <div className="mt-4">
          <ButtonLink href={`/movimientos?cuenta=${account.id}`} variant="secondary">
            Ver todos
          </ButtonLink>
        </div>
      )}

      <form action={setAccountArchivedAction} className="mt-8">
        <input type="hidden" name="id" value={account.id} />
        <input type="hidden" name="archived" value={account.archivedAt ? "0" : "1"} />
        {account.archivedAt ? (
          <button
            type="submit"
            className="min-h-14 w-full rounded-2xl border-2 border-border bg-surface text-lg font-semibold"
          >
            Volver a usar esta cuenta
          </button>
        ) : (
          <ConfirmButton
            title="¿Archivar esta cuenta?"
            message={
              <p>
                <strong>{account.name}</strong> ya no aparecerá para registrar. Sus movimientos se conservan y
                puedes volver a usarla cuando quieras.
              </p>
            }
            confirmLabel="Sí, archivar"
            variant="secondary"
          >
            <span aria-hidden="true">🗄️</span> Archivar cuenta
          </ConfirmButton>
        )}
      </form>
    </>
  );
}
