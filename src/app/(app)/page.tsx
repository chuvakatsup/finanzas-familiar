import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { ensureAutoSynced } from "@/server/sync";
import { listAccounts } from "@/server/services/accounts";
import { listUpcoming } from "@/server/services/scheduled";
import { listTransactions } from "@/server/services/transactions";
import { capitalize, formatLongDate, todayIso } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { formatMonth, monthOf, monthRange } from "@/domain/months";
import { summarize } from "@/domain/summary";
import { DueList } from "@/components/due-list";
import { TxList } from "@/components/tx-list";
import { ButtonLink, Card, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Inicio" };

const HOME_DUE_LIMIT = 4;

export default async function HomePage() {
  const user = await requireUser();
  await ensureAutoSynced();
  const today = todayIso();
  const month = monthOf(today);
  const [from, to] = monthRange(month);
  const db = getDb();
  const [rows, { overdue, upcoming }, accounts] = await Promise.all([
    listTransactions(db, user, { from, to }),
    listUpcoming(db, user, 7, today),
    listAccounts(db, user),
  ]);
  const totals = summarize(rows);
  const accountOptions = accounts.map(({ id, name, kind }) => ({ id, name, kind }));
  const nextWeek = upcoming;
  const shownNext = nextWeek.slice(0, HOME_DUE_LIMIT);

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

      <div className="mb-6">
        <ButtonLink href="/registrar">
          <span aria-hidden="true">➕</span> Registrar gasto
        </ButtonLink>
      </div>

      <DueList title="⚠️ Por confirmar" items={overdue} today={today} accounts={accountOptions} />
      <DueList
        title="📅 Próximos 7 días"
        items={shownNext}
        today={today}
        accounts={accountOptions}
        empty="No tienes pagos ni ingresos programados esta semana."
      />
      <div className="-mt-3 mb-6">
        <ButtonLink href="/proximos" variant="secondary">
          {nextWeek.length > HOME_DUE_LIMIT
            ? `Ver los ${nextWeek.length} de esta semana y más`
            : "Ver próximos 30 días"}
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
