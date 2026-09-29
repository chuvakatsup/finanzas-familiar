import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { getMonthReport } from "@/server/services/balance";
import { capitalize, todayIso } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { formatDay, monthOf } from "@/domain/months";
import { historyFiltersSchema } from "@/lib/schemas/finance";
import { MonthNav } from "@/components/month-nav";
import { Semaforo } from "@/components/semaforo";
import { ButtonLink, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Las cuentas del mes" };

function Row({ label, amount, sign, strong, hint }: { label: ReactNode; amount: number; sign?: "+" | "−"; strong?: boolean; hint?: ReactNode }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2 ${strong ? "font-bold" : ""}`}>
      <span className="text-lg">
        {label}
        {hint && <span className="block text-base font-normal text-muted">{hint}</span>}
      </span>
      <span className={`tabular shrink-0 text-lg ${sign === "+" ? "text-ok" : sign === "−" ? "text-danger" : ""}`}>
        {sign ?? ""}
        {formatMoney(amount)}
      </span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4 rounded-2xl border border-border bg-surface p-4">
      <h2 className="mb-1 text-xl font-bold">{title}</h2>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

export default async function MonthPage({ searchParams }: PageProps<"/mes">) {
  const actor = await requireUser();
  const today = todayIso();
  const { mes } = historyFiltersSchema.pick({ mes: true }).parse({ mes: (await searchParams).mes });
  const month = mes ?? monthOf(today);
  const report = await getMonthReport(getDb(), actor, month, today);
  const b = report.balance;
  const pendingIncome = report.due.filter((d) => d.kind === "ingreso" && d.status === "pendiente");
  const pendingPay = report.due.filter((d) => d.kind === "pago" && d.status === "pendiente");

  return (
    <>
      <PageTitle subtitle="Así se calcula si te alcanza.">Las cuentas del mes</PageTitle>
      <MonthNav month={month} hrefFor={(m) => `/mes?mes=${m}`} />
      <div className="mb-5">
        <Semaforo balance={b} />
      </div>

      <Block title="💰 Lo que te entra">
        <Row label="Ya te llegó" amount={b.income.received} sign="+" />
        {pendingIncome.map((d) => (
          <Row
            key={`${d.itemId}${d.dueDate}`}
            label={`Falta: ${d.name}`}
            hint={capitalize(formatDay(d.dueDate))}
            amount={d.amount}
            sign="+"
          />
        ))}
        {report.supportDue.expectedIncome.map((s, i) => (
          <Row key={`si${i}`} label={`Apoyo de ${s.from} (por confirmar)`} hint={capitalize(formatDay(s.date))} amount={s.amount} sign="+" />
        ))}
        <Row label="Total de ingresos" amount={b.income.total} strong />
      </Block>

      <Block title="🧾 Lo que sale">
        <Row label="Gastos del día a día" amount={b.spent.variable} sign="−" hint="Súper, comida, transporte…" />
        <Row label="Pagos fijos ya hechos" amount={b.spent.fixed} sign="−" />
        {b.spent.installments > 0 && <Row label="Mensualidades de compras a meses" amount={b.spent.installments} sign="−" />}
        {b.spent.debts > 0 && <Row label="Pagos a préstamos (capital)" amount={b.spent.debts} sign="−" hint="Los intereses están en pagos fijos" />}
        {b.spent.support > 0 && <Row label="Apoyos que enviaste" amount={b.spent.support} sign="−" />}
        {pendingPay.map((d) => (
          <Row
            key={`${d.itemId}${d.dueDate}`}
            label={`Falta pagar: ${d.name}`}
            hint={`${capitalize(formatDay(d.dueDate))}${d.amountIsEstimate ? " · aproximado" : ""}`}
            amount={d.amount}
            sign="−"
          />
        ))}
        {report.loanDue.map((l) => (
          <Row
            key={l.rowId}
            label={`Falta pagar: ${l.name} (pago ${l.number})`}
            hint={capitalize(formatDay(l.dueDate))}
            amount={l.amount}
            sign="−"
          />
        ))}
        {report.installments
          .filter((i) => i.dueDate > today)
          .map((i) => (
            <Row
              key={`${i.purchaseId}-${i.number}`}
              label={`Mensualidad: ${i.description} (${i.number} de ${i.months})`}
              hint={capitalize(formatDay(i.dueDate))}
              amount={i.amount}
              sign="−"
            />
          ))}
        {report.supportDue.commitments.map((s, i) => (
          <Row key={`sc${i}`} label={`Apoyo automático a ${s.to}`} hint={capitalize(formatDay(s.date))} amount={s.amount} sign="−" />
        ))}
        {b.expectedVariable > 0 && (
          <Row
            label="Apartado para gastos del resto del mes"
            hint={`Lo que queda de tu presupuesto de ${formatMoney(b.budget ?? 0)}`}
            amount={b.expectedVariable}
            sign="−"
          />
        )}
        <Row label="Total de gastos y compromisos" amount={b.outgoings} strong />
      </Block>

      <section className="mb-6 rounded-2xl border-2 border-text bg-surface p-4">
        <p className="text-lg">
          <span className="tabular text-ok">{formatMoney(b.income.total)}</span> −{" "}
          <span className="tabular text-danger">{formatMoney(b.outgoings)}</span> =
        </p>
        <p className={`tabular text-3xl font-extrabold ${b.result < 0 ? "text-danger" : "text-ok"}`}>
          {b.result < 0 ? "Te pasas por " : "Te queda "}
          {formatMoney(Math.abs(b.result))}
        </p>
        <p className="mt-2 text-base text-muted">
          Pagar la tarjeta de crédito no aparece aquí: ese gasto ya se contó el día que compraste.
        </p>
      </section>

      <div className="flex flex-col gap-3">
        <ButtonLink href={`/gastos?mes=${month}`} variant="secondary">
          <span aria-hidden="true">📊</span> ¿A dónde se va mi dinero?
        </ButtonLink>
        <ButtonLink href="/mas/presupuesto" variant="secondary">
          <span aria-hidden="true">🎯</span> Mi presupuesto
        </ButtonLink>
      </div>
    </>
  );
}
