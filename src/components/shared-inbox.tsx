"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import {
  type SharedSimpleAction,
  confirmSharedReceivedAction,
  markSharedPaidAction,
  sharedSimpleAction,
} from "@/server/actions/shared";
import { formatRate } from "@/domain/amortization";
import { capitalize } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { initialFormState } from "@/lib/form-state";
import { ConfirmButton } from "./confirm-button";
import { Alert, Button } from "./ui";

export type SharedItem = {
  id: string;
  /** Solo para el dueño (para abrir su gasto). */
  sourceTxId: string | null;
  amount: number;
  percentBp: number | null;
  date: string;
  concept: string;
  status: "pendiente" | "pagado" | "recibido" | "rechazado";
  iAmOwner: boolean;
  ownerName: string;
  debtorName: string;
};

export type SharedAccounts = {
  /** De dónde puede salir el pago (efectivo, débito, ahorro). */
  payFrom: { id: string; name: string }[];
  /** A dónde puede llegar (cuentas y tarjetas: directo a la tarjeta baja la deuda). */
  receiveInto: { id: string; name: string; kind: string }[];
};

const selectCls = "min-h-14 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg font-normal";
const undoCls = "min-h-12 rounded-xl border-2 border-border bg-surface px-4 text-base font-semibold";

function useSimple(id: string) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (what: SharedSimpleAction) =>
    start(async () => {
      const r = await sharedSimpleAction(id, what);
      setError(r.message ?? null);
    });
  return { busy, error, run };
}

function DoneRow({ text, onUndo, busy }: { text: string; onUndo?: () => void; busy: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface p-3">
      <p className="text-lg font-semibold">{text}</p>
      {onUndo && (
        <button type="button" disabled={busy} onClick={onUndo} className={undoCls}>
          ↩️ {busy ? "Deshaciendo…" : "Deshacer"}
        </button>
      )}
    </div>
  );
}

/** Quien debe: "Te toca pagar" → "Ya te pagué" (de qué cuenta) o "Esto no es mío". */
function DebtorBody({ item, accounts }: { item: SharedItem; accounts: SharedAccounts }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(markSharedPaidAction.bind(null, item.id), initialFormState);
  const { busy, error, run } = useSimple(item.id);

  if (item.status === "pagado") {
    return (
      <>
        <DoneRow text={`✅ Pagado. Le avisamos a ${item.ownerName}.`} onUndo={() => run("deshacer-pago")} busy={busy} />
        {error && <Alert>{error}</Alert>}
      </>
    );
  }
  if (item.status === "rechazado") {
    return (
      <>
        <DoneRow text={`Le avisamos a ${item.ownerName} que no te toca.`} onUndo={() => run("deshacer-rechazo")} busy={busy} />
        {error && <Alert>{error}</Alert>}
      </>
    );
  }
  if (item.status !== "pendiente") return null;

  return (
    <>
      {(state.message || error) && <Alert>{state.message ?? error}</Alert>}
      {!open ? (
        <div className="flex flex-col gap-2">
          <Button type="button" onClick={() => setOpen(true)}>
            ✅ Ya te pagué
          </Button>
          <form action={() => run("rechazar")}>
            <ConfirmButton
              look="link"
              title="¿Esto no es tuyo?"
              message={<p>Le avisaremos a {item.ownerName} que este gasto no te toca, y dejará de contar para ti.</p>}
              confirmLabel="Sí, no es mío"
              variant="secondary"
            >
              Esto no es mío
            </ConfirmButton>
          </form>
        </div>
      ) : accounts.payFrom.length === 0 ? (
        <Alert kind="warn">Primero agrega una cuenta de efectivo o débito para registrar el pago.</Alert>
      ) : (
        <form action={action} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-lg font-semibold">
            ¿De qué cuenta salió?
            <select name="fromAccountId" defaultValue={accounts.payFrom[0].id} className={selectCls}>
              {accounts.payFrom.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : `Confirmar que le pagué ${formatMoney(item.amount)}`}
          </Button>
          <button type="button" onClick={() => setOpen(false)} className="min-h-12 text-base font-semibold text-primary underline">
            Regresar
          </button>
        </form>
      )}
    </>
  );
}

/** Dueño: "¿Te llegó?" (a qué cuenta o tarjeta), "Recibido" con deshacer, o aviso de "no es mío". */
function OwnerBody({ item, accounts }: { item: SharedItem; accounts: SharedAccounts }) {
  const [state, action, pending] = useActionState(confirmSharedReceivedAction.bind(null, item.id), initialFormState);
  const { busy, error, run } = useSimple(item.id);
  const cards = accounts.receiveInto.filter((a) => a.kind === "credito");
  const money = accounts.receiveInto.filter((a) => a.kind !== "credito");

  if (item.status === "recibido") {
    return (
      <>
        <DoneRow text="✅ Recibido. ¡Listo!" onUndo={() => run("deshacer-recibido")} busy={busy} />
        {error && <Alert>{error}</Alert>}
      </>
    );
  }
  if (item.status === "rechazado") {
    return (
      <div className="flex flex-col gap-2">
        {error && <Alert>{error}</Alert>}
        <Button type="button" variant="secondary" disabled={busy} onClick={() => run("entendido")}>
          Entendido
        </Button>
        {item.sourceTxId && (
          <Link href={`/movimientos/${item.sourceTxId}`} className="flex min-h-12 items-center text-base font-semibold text-primary underline">
            Ver el gasto para repartirlo de otra forma
          </Link>
        )}
      </div>
    );
  }
  if (item.status === "pendiente") {
    return <p className="text-lg text-muted">Esperando a que {item.debtorName} te pague.</p>;
  }

  return (
    <>
      {(state.message || error) && <Alert>{state.message ?? error}</Alert>}
      <form action={action} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-lg font-semibold">
          ¿A dónde te llegó?
          <select name="accountId" defaultValue={cards[0]?.id ?? money[0]?.id} className={selectCls}>
            {cards.map((a) => (
              <option key={a.id} value={a.id}>
                Directo a mi tarjeta {a.name}
              </option>
            ))}
            {money.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "✅ Sí, me llegó"}
        </Button>
      </form>
    </>
  );
}

function headline(item: SharedItem) {
  const pct = item.percentBp != null ? ` (${formatRate(item.percentBp)})` : "";
  if (!item.iAmOwner) {
    return (
      <>
        {item.ownerName} pagó <strong>{item.concept}</strong>. Te toca{" "}
        <span className="tabular text-2xl text-danger">{formatMoney(item.amount)}</span>
        {pct}.
      </>
    );
  }
  if (item.status === "rechazado") {
    return (
      <>
        {item.debtorName} dice que <strong>{item.concept}</strong> ({formatMoney(item.amount)}) no le toca. Ahora cuenta
        completo para ti.
      </>
    );
  }
  if (item.status === "pendiente") {
    return (
      <>
        {item.debtorName} te debe <span className="tabular text-2xl text-ok">{formatMoney(item.amount)}</span> de{" "}
        <strong>{item.concept}</strong>
        {pct}.
      </>
    );
  }
  return (
    <>
      {item.debtorName} dice que ya te pagó <span className="tabular text-2xl text-ok">{formatMoney(item.amount)}</span> de{" "}
      <strong>{item.concept}</strong>. ¿Te llegó?
    </>
  );
}

export function SharedCard({ item, accounts }: { item: SharedItem; accounts: SharedAccounts }) {
  const warn = item.status === "rechazado" && item.iAmOwner;
  return (
    <article
      aria-label={`Gasto compartido: ${item.concept}`}
      className={`flex flex-col gap-3 rounded-3xl border-4 p-5 ${warn ? "border-warn bg-warn-bg" : "border-primary bg-surface"}`}
    >
      <p className="text-xl font-bold leading-snug">
        <span aria-hidden="true">👥 </span>
        {headline(item)}
      </p>
      <p className="text-base text-muted">{capitalize(formatDay(item.date))}</p>
      {item.iAmOwner ? <OwnerBody item={item} accounts={accounts} /> : <DebtorBody item={item} accounts={accounts} />}
    </article>
  );
}

/** Bandeja de Inicio: solo lo que pide una acción (o se acaba de hacer, para deshacer). */
export function SharedInbox({ items, accounts }: { items: SharedItem[]; accounts: SharedAccounts }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Gastos compartidos por atender" className="mb-5 flex flex-col gap-3">
      {items.map((i) => (
        <SharedCard key={i.id} item={i} accounts={accounts} />
      ))}
    </section>
  );
}
