import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { getPrefs } from "@/server/services/prefs";
import { listSupportSchedules, listSupports } from "@/server/services/support";
import { setSupportPendingPrefAction, stopSupportScheduleAction } from "@/server/actions/support";
import { capitalize } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { FREQUENCY_INFO } from "@/domain/recurrence";
import { ConfirmButton } from "@/components/confirm-button";
import { SupportInbox } from "@/components/support-inbox";
import { Alert, ButtonLink, Card, PageTitle } from "@/components/ui";
import { inboxData } from "./data";

export const metadata: Metadata = { title: "Apoyos familiares" };

const STATUS = {
  enviado: { label: "Por confirmar", icon: "⏳", cls: "text-warn" },
  recibido: { label: "Recibido", icon: "✅", cls: "text-ok" },
  cancelado: { label: "Cancelado", icon: "✖️", cls: "text-muted" },
} as const;

export default async function SupportsPage({ searchParams }: PageProps<"/apoyos">) {
  const actor = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const [history, schedules, inbox, prefs] = await Promise.all([
    listSupports(db, actor),
    listSupportSchedules(db, actor),
    inboxData(db, actor),
    getPrefs(db, actor),
  ]);
  const countPending = prefs.apoyosPendientesCuentan ?? true;

  return (
    <>
      <PageTitle subtitle="El dinero se manda por el banco; aquí solo lo anotan los dos.">Apoyos familiares</PageTitle>
      {sp.programado && <Alert kind="ok">Apoyo programado. Se enviará solo en cada fecha.</Alert>}
      {sp.detenido && <Alert kind="ok">Apoyo automático detenido.</Alert>}

      <div className="mb-5">
        <ButtonLink href="/apoyos/enviar">
          <span aria-hidden="true">🤝</span> Enviar apoyo
        </ButtonLink>
      </div>

      <SupportInbox items={inbox.items} options={inbox.options} />

      {schedules.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-2xl font-bold">Apoyos automáticos</h2>
          <ul className="flex flex-col gap-3">
            {schedules.map((s) => (
              <li key={s.id} className="rounded-2xl border border-border bg-surface p-4">
                <p className="text-lg font-semibold">
                  {s.iAmSender ? `A ${s.recipientName}` : `De ${s.senderName}`}:{" "}
                  <span className="tabular">{formatMoney(s.amount)}</span>
                </p>
                <p className="text-base text-muted">{FREQUENCY_INFO[s.frequency].label}</p>
                {s.iAmSender && (
                  <form action={stopSupportScheduleAction} className="mt-2">
                    <input type="hidden" name="id" value={s.id} />
                    <ConfirmButton
                      look="link"
                      title="¿Detener este apoyo automático?"
                      message={<p>Ya no se enviará solo. Los apoyos que ya se enviaron se conservan.</p>}
                      confirmLabel="Sí, detener"
                      variant="secondary"
                    >
                      Detener
                    </ConfirmButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className="mb-3 text-2xl font-bold">Historial</h2>
      {history.length === 0 ? (
        <p className="mb-6 rounded-2xl bg-surface-2 p-4 text-lg text-muted">Todavía no hay apoyos.</p>
      ) : (
        <ul className="mb-6 flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {history.map((h) => {
            const st = STATUS[h.status];
            return (
              <li key={h.id}>
                <Link href={`/apoyos/${h.id}`} className="flex min-h-16 items-center gap-3 p-3 hover:bg-surface-2">
                  <span aria-hidden="true" className="text-2xl">
                    {h.iAmSender ? "📤" : "📥"}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-lg font-semibold">
                      {h.iAmSender ? `Enviaste a ${h.recipientName}` : `Te envió ${h.senderName}`}
                    </span>
                    <span className="text-base text-muted">
                      {capitalize(formatDay(h.date))} ·{" "}
                      <span className={st.cls}>
                        {st.icon} {st.label}
                      </span>
                    </span>
                  </span>
                  <span className={`tabular shrink-0 text-lg font-bold ${h.iAmSender ? "text-danger" : "text-ok"}`}>
                    {h.iAmSender ? "−" : "+"}
                    {formatMoney(h.amount)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Card>
        <h2 className="mb-2 text-xl font-bold">Apoyos que aún no confirmas</h2>
        <p className="mb-3 text-base text-muted">
          {countPending
            ? "Ahora sí cuentan como dinero que te va a llegar en tu semáforo."
            : "Ahora NO cuentan en tu semáforo hasta que confirmes que los recibiste."}
        </p>
        <form action={setSupportPendingPrefAction}>
          <input type="hidden" name="value" value={countPending ? "0" : "1"} />
          <button type="submit" className="min-h-14 w-full rounded-2xl border-2 border-border bg-surface text-lg font-semibold">
            {countPending ? "No contarlos hasta confirmar" : "Sí contarlos como esperados"}
          </button>
        </form>
      </Card>
    </>
  );
}
