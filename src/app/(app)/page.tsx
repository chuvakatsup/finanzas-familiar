import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { ensureAutoSynced } from "@/server/sync";
import { listAccounts } from "@/server/services/accounts";
import { getMonthReport } from "@/server/services/balance";
import { getPrefs } from "@/server/services/prefs";
import { listAllUpcoming } from "@/server/services/upcoming";
import { capitalize, formatLongDate, todayIso } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { monthOf } from "@/domain/months";
import { historyFiltersSchema } from "@/lib/schemas/finance";
import { DueList } from "@/components/due-list";
import { MonthNav } from "@/components/month-nav";
import { MonthFigures, Semaforo } from "@/components/semaforo";
import { TxList } from "@/components/tx-list";
import { ButtonLink, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Inicio" };

const HOME_DUE_LIMIT = 4;

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  await ensureAutoSynced();
  const today = todayIso();
  const { mes } = historyFiltersSchema.pick({ mes: true }).parse({ mes: (await searchParams).mes });
  const month = mes ?? monthOf(today);
  const isCurrent = month === monthOf(today);
  const db = getDb();

  const [report, prefs, upcomingData, accounts] = await Promise.all([
    getMonthReport(db, user, month, today),
    getPrefs(db, user),
    isCurrent ? listAllUpcoming(db, user, 7, today) : Promise.resolve(null),
    isCurrent ? listAccounts(db, user) : Promise.resolve([]),
  ]);
  const b = report.balance;
  const accountOptions = accounts.map(({ id, name, kind }) => ({ id, name, kind }));
  const showWelcome = !prefs.bienvenidaHecha && isCurrent && b.status === "sin-datos";

  return (
    <>
      <header className="mb-4">
        <h1 className="text-3xl font-bold leading-tight">Hola, {user.name}</h1>
        <p className="text-lg text-muted">{capitalize(formatLongDate(today))}</p>
      </header>

      {showWelcome && (
        <Card className="mb-5 border-2 border-primary">
          <p className="text-2xl font-bold">
            <span aria-hidden="true">👋 </span>¡Empecemos!
          </p>
          <p className="mt-2 text-lg">
            En 3 pasos cortos anotamos tu dinero, lo que te llega y lo que pagas cada mes. Así la app te dirá si
            te alcanza.
          </p>
          <div className="mt-4">
            <ButtonLink href="/bienvenida">Empezar</ButtonLink>
          </div>
        </Card>
      )}

      <MonthNav month={month} hrefFor={(m) => (m === monthOf(today) ? "/" : `/?mes=${m}`)} />

      <div className="mb-4 flex flex-col gap-3">
        <Semaforo balance={b} />
        {b.status !== "sin-datos" && <MonthFigures balance={b} />}
      </div>

      {isCurrent && b.status !== "sin-datos" && b.dailyAllowance != null && (
        <Card className="mb-4">
          <p className="text-lg">
            Para lo que resta del mes ({b.daysLeft} {b.daysLeft === 1 ? "día" : "días"}) tienes{" "}
            <strong className="tabular">{formatMoney(Math.max(0, b.available))}</strong>.
          </p>
          <p className="mt-2 text-xl font-semibold">
            {b.dailyAllowance > 0 ? (
              <>
                <span aria-hidden="true">🗓️ </span>Puedes gastar{" "}
                <span className="tabular text-2xl text-ok">{formatMoney(b.dailyAllowance)}</span> al día para
                llegar bien.
              </>
            ) : (
              <span className="text-danger">
                <span aria-hidden="true">⛔ </span>Ya no hay margen para gastos extra este mes.
              </span>
            )}
          </p>
          {b.budget != null && (
            <p className="mt-2 text-base text-muted">
              De tu presupuesto de {formatMoney(b.budget)} te quedan {formatMoney(b.budgetLeft ?? 0)}.
            </p>
          )}
        </Card>
      )}

      <div className="mb-6 flex flex-col gap-3">
        {isCurrent && (
          <ButtonLink href="/registrar">
            <span aria-hidden="true">➕</span> Registrar gasto
          </ButtonLink>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Link
            href={`/mes?mes=${month}`}
            className="flex min-h-16 items-center justify-center rounded-2xl border-2 border-border bg-surface p-2 text-center text-base font-semibold"
          >
            <span aria-hidden="true">🧮&nbsp;</span>Ver las cuentas del mes
          </Link>
          <Link
            href={`/gastos?mes=${month}`}
            className="flex min-h-16 items-center justify-center rounded-2xl border-2 border-border bg-surface p-2 text-center text-base font-semibold"
          >
            <span aria-hidden="true">📊&nbsp;</span>¿A dónde se va mi dinero?
          </Link>
        </div>
      </div>

      {upcomingData && (
        <>
          <DueList title="⚠️ Por confirmar" items={upcomingData.overdue} today={today} accounts={accountOptions} />
          <DueList
            title="📅 Próximos 7 días"
            items={upcomingData.upcoming.slice(0, HOME_DUE_LIMIT)}
            today={today}
            accounts={accountOptions}
            empty="No tienes pagos ni ingresos programados esta semana."
          />
          <div className="-mt-3 mb-6">
            <ButtonLink href="/proximos" variant="secondary">
              {upcomingData.upcoming.length > HOME_DUE_LIMIT
                ? `Ver los ${upcomingData.upcoming.length} de esta semana y más`
                : "Ver próximos 30 días"}
            </ButtonLink>
          </div>
        </>
      )}

      <h2 className="mb-3 text-2xl font-bold">{isCurrent ? "Lo último" : "Movimientos del mes"}</h2>
      <TxList rows={report.txs.slice(0, 5)} back={isCurrent ? "/" : `/?mes=${month}`} />
      {report.txs.length > 0 && (
        <div className="mt-4">
          <ButtonLink href={`/movimientos?mes=${month}`} variant="secondary">
            Ver todos los movimientos
          </ButtonLink>
        </div>
      )}
    </>
  );
}
