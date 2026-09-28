import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { type AccountWithBalance, listAccounts } from "@/server/services/accounts";
import { ACCOUNT_KIND_INFO, creditSummary } from "@/domain/accounts";
import { formatMoney } from "@/domain/money";
import { Alert, ButtonLink, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Mis cuentas" };

function AccountCard({ a }: { a: AccountWithBalance }) {
  const info = ACCOUNT_KIND_INFO[a.kind];
  const credit = a.kind === "credito" ? creditSummary(a.balance, a.creditLimit) : null;
  return (
    <li>
      {/* Dos renglones: nombre completo arriba; tipo y saldo abajo (cabe bien a 360px). */}
      <Link
        href={`/cuentas/${a.id}`}
        className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 hover:bg-surface-2"
      >
        <span className="flex items-center gap-3">
          <span aria-hidden="true" className="text-3xl">
            {info.icon}
          </span>
          <span className="flex-1 wrap-break-word text-xl font-semibold leading-snug">{a.name}</span>
          <span aria-hidden="true" className="text-2xl text-muted">
            ›
          </span>
        </span>
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-base text-muted">
            {info.label}
            {a.last4 ? ` ···${a.last4}` : ""}
          </span>
          {credit ? (
            <span className="text-base text-muted">
              Debes{" "}
              <span className={`tabular text-xl font-bold ${credit.owed > 0 ? "text-danger" : "text-text"}`}>
                {formatMoney(credit.owed)}
              </span>
            </span>
          ) : (
            <span className="text-base text-muted">
              Tienes{" "}
              <span className={`tabular text-xl font-bold ${a.balance < 0 ? "text-danger" : "text-text"}`}>
                {formatMoney(a.balance)}
              </span>
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

export default async function AccountsPage({ searchParams }: PageProps<"/cuentas">) {
  const actor = await requireUser();
  const all = await listAccounts(getDb(), actor, { includeArchived: true });
  const { archivada } = await searchParams;
  const active = all.filter((a) => !a.archivedAt);
  const archived = all.filter((a) => a.archivedAt);
  const money = active.filter((a) => !ACCOUNT_KIND_INFO[a.kind].isDebt);
  const debts = active.filter((a) => ACCOUNT_KIND_INFO[a.kind].isDebt);
  const totalMoney = money.reduce((s, a) => s + a.balance, 0);
  const totalOwed = debts.reduce((s, a) => s + Math.max(0, -a.balance), 0);

  return (
    <>
      <PageTitle>Mis cuentas</PageTitle>
      {archivada && <Alert kind="ok">Cuenta archivada. Sus movimientos se conservan.</Alert>}

      <section aria-labelledby="dinero" className="mb-6">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 id="dinero" className="text-2xl font-bold">
            Tu dinero
          </h2>
          <p className="text-right text-base text-muted">
            Total <strong className="tabular text-xl text-text">{formatMoney(totalMoney)}</strong>
          </p>
        </div>
        <ul className="flex flex-col gap-3">
          {money.map((a) => (
            <AccountCard key={a.id} a={a} />
          ))}
        </ul>
      </section>

      {debts.length > 0 && (
        <section aria-labelledby="deudas" className="mb-6">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="deudas" className="text-2xl font-bold">
              Tarjetas y préstamos
            </h2>
            <p className="text-right text-base text-muted">
              Debes <strong className="tabular text-xl text-danger">{formatMoney(totalOwed)}</strong>
            </p>
          </div>
          <ul className="flex flex-col gap-3">
            {debts.map((a) => (
              <AccountCard key={a.id} a={a} />
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-3">
        <ButtonLink href="/cuentas/nueva">
          <span aria-hidden="true">➕</span> Agregar cuenta o tarjeta
        </ButtonLink>
        <ButtonLink href="/prestamos/nuevo" variant="secondary">
          <span aria-hidden="true">📄</span> Agregar préstamo
        </ButtonLink>
        <ButtonLink href="/registrar/transferencia" variant="secondary">
          <span aria-hidden="true">🔁</span> Pasar dinero o pagar tarjeta
        </ButtonLink>
      </div>

      {archived.length > 0 && (
        <details className="mt-8 rounded-2xl border border-border bg-surface p-4">
          <summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">
            Cuentas archivadas ({archived.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-3">
            {archived.map((a) => (
              <AccountCard key={a.id} a={a} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
