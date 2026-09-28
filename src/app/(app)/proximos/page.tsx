import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { listAccounts } from "@/server/services/accounts";
import { listAllUpcoming } from "@/server/services/upcoming";
import { todayIso } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { addDays } from "@/domain/recurrence";
import { DueList } from "@/components/due-list";
import { ButtonLink, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Próximos pagos" };

export default async function UpcomingPage({ searchParams }: PageProps<"/proximos">) {
  const actor = await requireUser();
  const { dias } = await searchParams;
  const days = dias === "7" ? 7 : 30;
  const today = todayIso();
  const db = getDb();
  const [{ overdue, upcoming }, accounts] = await Promise.all([
    listAllUpcoming(db, actor, days, today),
    listAccounts(db, actor),
  ]);
  const accountOptions = accounts.map(({ id, name, kind }) => ({ id, name, kind }));
  const pending = [...overdue, ...upcoming.filter((u) => u.status === "pendiente")];
  const toPay = pending.filter((d) => d.kind === "pago").reduce((s, d) => s + d.amount, 0);
  const toReceive = pending.filter((d) => d.kind === "ingreso").reduce((s, d) => s + d.amount, 0);
  const in7 = addDays(today, 7);

  const tab = (n: 7 | 30) => (
    <Link
      href={`/proximos?dias=${n}`}
      aria-current={days === n ? "page" : undefined}
      className={`flex min-h-14 items-center justify-center rounded-2xl border-2 text-lg font-semibold ${
        days === n ? "border-primary bg-primary text-on-primary" : "border-border bg-surface"
      }`}
    >
      {n} días
    </Link>
  );

  return (
    <>
      <PageTitle>Próximos pagos</PageTitle>
      <nav aria-label="Ver los próximos" className="mb-4 grid grid-cols-2 gap-2">
        {tab(7)}
        {tab(30)}
      </nav>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-surface p-3">
          <p className="text-base text-muted">Por pagar</p>
          <p className="tabular text-2xl font-bold text-danger">{formatMoney(toPay)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-3">
          <p className="text-base text-muted">Por recibir</p>
          <p className="tabular text-2xl font-bold text-ok">{formatMoney(toReceive)}</p>
        </div>
      </div>

      <DueList title="⚠️ Pendientes de días pasados" items={overdue} today={today} accounts={accountOptions} />
      <DueList
        title="Esta semana"
        items={upcoming.filter((u) => u.dueDate < in7)}
        today={today}
        accounts={accountOptions}
        empty="Nada en los próximos 7 días."
      />
      {days === 30 && (
        <DueList
          title="Más adelante"
          items={upcoming.filter((u) => u.dueDate >= in7)}
          today={today}
          accounts={accountOptions}
          empty="Nada más en los próximos 30 días."
        />
      )}

      <div className="flex flex-col gap-3">
        <ButtonLink href="/pagos-fijos" variant="secondary">
          <span aria-hidden="true">🧾</span> Mis pagos fijos
        </ButtonLink>
        <ButtonLink href="/prestamos" variant="secondary">
          <span aria-hidden="true">📄</span> Mis préstamos
        </ButtonLink>
        <ButtonLink href="/ingresos-fijos" variant="secondary">
          <span aria-hidden="true">💼</span> Mis ingresos fijos
        </ButtonLink>
      </div>
    </>
  );
}
