import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { transactions } from "@/server/db/schema";
import { requireUser } from "@/server/auth/current";
import { AuthzError } from "@/server/authz";
import { listAccounts } from "@/server/services/accounts";
import { getSupport } from "@/server/services/support";
import { capitalize } from "@/domain/dates";
import { centsToInput, formatMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { SupportInbox } from "@/components/support-inbox";
import { Alert, Card } from "@/components/ui";
import { inboxData } from "../data";
import { CancelSupport, EditSupportForm, UndoReceive } from "./support-forms";

export const metadata: Metadata = { title: "Apoyo" };

const APPLIED = {
  ninguno: "Lo recibió sin aplicarlo a una deuda.",
  tarjeta: "Lo usó para pagar su tarjeta.",
  cuota: "Lo usó para pagar una cuota de su préstamo.",
  abono: "Lo usó para abonar a su préstamo.",
} as const;

export default async function SupportPage({ params, searchParams }: PageProps<"/apoyos/[id]">) {
  const actor = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const s = await getSupport(db, actor, id).catch((e) => {
    if (e instanceof AuthzError) notFound();
    throw e;
  });
  const other = s.iAmSender ? s.recipientName : s.senderName;
  // Quien envía puede editar mientras esté pendiente; quien recibe ve el "¿Ya lo recibiste?".
  const editable = s.iAmSender && s.status === "enviado";
  const [accounts, senderTx, recipientInbox] = await Promise.all([
    editable ? listAccounts(db, actor) : Promise.resolve([]),
    editable && s.senderTxId
      ? db.select({ from: transactions.fromAccountId }).from(transactions).where(eq(transactions.id, s.senderTxId)).limit(1)
      : Promise.resolve([]),
    !s.iAmSender && s.status === "enviado" ? inboxData(db, actor) : Promise.resolve(null),
  ]);
  const senderAccounts = accounts.filter((a) => a.kind !== "credito" && a.kind !== "prestamo").map(({ id: aid, name }) => ({ id: aid, name }));
  const senderAccountId = senderTx[0]?.from ?? senderAccounts[0]?.id ?? "";
  const inbox = recipientInbox
    ? {
        options: recipientInbox.options,
        items: [{ id: s.id, senderName: s.senderName, amount: s.amount, date: s.date, purpose: s.purpose, note: s.note, received: false }],
      }
    : null;

  return (
    <>
      <p className="mb-3">
        <Link href="/apoyos" className="inline-flex min-h-12 items-center text-lg font-semibold text-primary underline">
          ‹ Apoyos
        </Link>
      </p>
      {sp.enviado && (
        <Alert kind="ok">
          Listo. {s.recipientName} verá el aviso “¿Ya lo recibiste?” al abrir la app.
        </Alert>
      )}
      <Card className="my-4">
        <p className="text-lg text-muted">{s.iAmSender ? `Enviaste a ${other}` : `${other} te envió`}</p>
        <p className={`tabular text-4xl font-extrabold ${s.iAmSender ? "text-danger" : "text-ok"}`}>{formatMoney(s.amount)}</p>
        <p className="mt-1 text-lg">{capitalize(formatDay(s.date))}</p>
        <p className="text-lg">{s.purpose === "deuda" ? "💳 Para pagar una deuda" : "💰 Para lo que necesite"}</p>
        {s.note && <p className="mt-1 text-lg">“{s.note}”</p>}
        <p className="mt-3 text-xl font-semibold">
          {s.status === "enviado" && "⏳ Esperando que confirme que lo recibió"}
          {s.status === "recibido" && "✅ Recibido"}
          {s.status === "cancelado" && "✖️ Cancelado"}
        </p>
        {s.status === "recibido" && <p className="text-base text-muted">{APPLIED[s.appliedKind]}</p>}
      </Card>

      {s.iAmSender && s.status === "enviado" && (
        <>
          <details className="mb-4 rounded-2xl border border-border bg-surface p-4">
            <summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">✏️ Cambiar monto, fecha o nota</summary>
            <EditSupportForm
              id={s.id}
              amount={centsToInput(s.amount)}
              date={s.date}
              note={s.note ?? ""}
              fromAccountId={senderAccountId}
              accounts={senderAccounts}
            />
          </details>
          <CancelSupport id={s.id} cancelled={false} />
        </>
      )}
      {s.iAmSender && s.status === "cancelado" && <CancelSupport id={s.id} cancelled />}
      {inbox && <SupportInbox items={inbox.items} options={inbox.options} />}
      {!s.iAmSender && s.status === "recibido" && <UndoReceive id={s.id} />}
    </>
  );
}
