import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { listTransactions } from "@/server/services/transactions";
import { capitalize, formatLongDate, todayIso } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { formatMonth, monthOf, monthRange } from "@/domain/months";
import { summarize } from "@/domain/summary";
import { TxList } from "@/components/tx-list";
import { ButtonLink, Card, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Inicio" };

export default async function HomePage() {
  const user = await requireUser();
  const today = todayIso();
  const month = monthOf(today);
  const [from, to] = monthRange(month);
  const rows = await listTransactions(getDb(), user, { from, to });
  const totals = summarize(rows);

  return (
    <>
      <PageTitle subtitle={capitalize(formatLongDate(today))}>Hola, {user.name}</PageTitle>

      <Card className="mb-5">
        <p className="text-lg text-muted">En {formatMonth(month).replace(/ de \d+$/, "")} llevas gastado</p>
        <p className="tabular text-4xl font-bold text-danger">{formatMoney(totals.spent)}</p>
        <p className="mt-2 text-lg">
          Te ha entrado <strong className="tabular text-ok">{formatMoney(totals.received)}</strong>
        </p>
        <p className="mt-3 rounded-xl bg-surface-2 p-3 text-base text-muted">
          <span aria-hidden="true">🚧 </span>Pronto aquí verás si te alcanza el dinero este mes.
        </p>
      </Card>

      <div className="mb-6 flex flex-col gap-3">
        <ButtonLink href="/registrar">
          <span aria-hidden="true">➕</span> Registrar gasto
        </ButtonLink>
      </div>

      <h2 className="mb-3 text-2xl font-bold">Lo último</h2>
      <TxList rows={rows.slice(0, 5)} back="/" />
      {rows.length > 0 && (
        <div className="mt-4">
          <ButtonLink href="/movimientos" variant="secondary">
            Ver todos mis movimientos
          </ButtonLink>
        </div>
      )}
    </>
  );
}
