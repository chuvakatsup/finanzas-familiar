import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { listShared, sharedTotals } from "@/server/services/shared";
import { capitalize } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { SharedCard } from "@/components/shared-inbox";
import { ButtonLink, Card, PageTitle } from "@/components/ui";
import { sharedAccounts, toItem } from "./data";

export const metadata: Metadata = { title: "Gastos compartidos" };

const DONE_LABEL = { recibido: "✅ Pagado", rechazado: "✖️ No tocaba (no se cobra)" } as const;

export default async function SharedPage() {
  const actor = await requireUser();
  const db = getDb();
  const [all, accounts] = await Promise.all([listShared(db, actor), sharedAccounts(db, actor)]);
  const totals = sharedTotals(all);
  const iOwe = all.filter((s) => !s.iAmOwner && s.status === "pendiente");
  const owedToMe = all.filter((s) => s.iAmOwner && (s.status === "pendiente" || s.status === "pagado"));
  const history = all.filter((s) => s.status === "recibido" || s.status === "rechazado" || (!s.iAmOwner && s.status === "pagado"));

  return (
    <>
      <PageTitle subtitle="Gastos que pagó una persona y se reparten con la familia.">Gastos compartidos</PageTitle>

      <dl className="mb-6 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border-2 border-border bg-surface p-4">
          <dt className="text-lg">Te deben</dt>
          <dd className="tabular text-2xl font-bold text-ok">{formatMoney(totals.owedToMe)}</dd>
        </div>
        <div className="rounded-2xl border-2 border-border bg-surface p-4">
          <dt className="text-lg">Debes</dt>
          <dd className="tabular text-2xl font-bold text-danger">{formatMoney(totals.iOwe)}</dd>
        </div>
      </dl>

      {iOwe.length > 0 && (
        <section aria-labelledby="sec-debes" className="mb-6 flex flex-col gap-3">
          <h2 id="sec-debes" className="text-2xl font-bold">
            Lo que debes
          </h2>
          {iOwe.map((s) => (
            <SharedCard key={s.id} item={toItem(s)} accounts={accounts} />
          ))}
        </section>
      )}

      {owedToMe.length > 0 && (
        <section aria-labelledby="sec-deben" className="mb-6 flex flex-col gap-3">
          <h2 id="sec-deben" className="text-2xl font-bold">
            Lo que te deben
          </h2>
          {owedToMe.map((s) => (
            <SharedCard key={s.id} item={toItem(s)} accounts={accounts} />
          ))}
        </section>
      )}

      {iOwe.length === 0 && owedToMe.length === 0 && (
        <Card className="mb-6">
          <p className="text-lg">No hay nada pendiente.</p>
          <p className="mt-2 text-base text-muted">
            Para compartir un gasto, al registrarlo toca “¿Es compartido con tu familia?” y elige cuánto le toca a cada
            quien, en porcentaje o en pesos.
          </p>
        </Card>
      )}

      {history.length > 0 && (
        <section aria-labelledby="sec-historial" className="mb-6">
          <h2 id="sec-historial" className="mb-3 text-2xl font-bold">
            Ya saldados
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-surface">
            {history.slice(0, 50).map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-3 p-4">
                <span className="min-w-0">
                  <span className="wrap-break-word block text-lg font-semibold">{s.concept}</span>
                  <span className="block text-base text-muted">
                    {s.iAmOwner ? `Con ${s.debtorName}` : `Con ${s.ownerName}`} · {capitalize(formatDay(s.date))}
                  </span>
                  <span className="block text-base text-muted">
                    {s.status === "pagado" ? `⏳ Falta que ${s.ownerName} lo confirme` : DONE_LABEL[s.status as keyof typeof DONE_LABEL]}
                  </span>
                </span>
                <span className="tabular shrink-0 text-lg font-bold">{formatMoney(s.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ButtonLink href="/registrar">
        <span aria-hidden="true">➕</span> Registrar un gasto compartido
      </ButtonLink>
    </>
  );
}
