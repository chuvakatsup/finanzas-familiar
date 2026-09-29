"use client";

import { useActionState, useState, useTransition } from "react";
import { receiveSupportAction, snoozeSupportAction, undoReceiveSupportAction } from "@/server/actions/support";
import { capitalize } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { initialFormState } from "@/lib/form-state";
import { Choice } from "./choice";
import { Alert, Button } from "./ui";

export type InboxItem = {
  id: string;
  senderName: string;
  amount: number;
  date: string;
  purpose: "general" | "deuda";
  note: string | null;
  /** Ya lo confirmó hoy (se muestra con "Deshacer"). */
  received: boolean;
};

export type ApplyOptions = {
  accounts: { id: string; name: string; kind: string }[];
  cards: { id: string; name: string }[];
  loans: { id: string; name: string }[];
};

const selectCls = "min-h-14 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg font-normal";

/** "Daniel te envió $1,500 de apoyo. ¿Ya lo recibiste?" con botones grandes. */
function InboxCard({ item, options }: { item: InboxItem; options: ApplyOptions }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(receiveSupportAction.bind(null, item.id), initialFormState);
  const [hidden, setHidden] = useState(false);
  const [busy, start] = useTransition();
  const [undone, setUndone] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const received = (item.received || state.data?.done === "recibido") && !undone;
  const money = options.accounts.filter((a) => a.kind !== "credito" && a.kind !== "prestamo");
  const hasDebts = options.cards.length + options.loans.length > 0;
  const defaultApply =
    item.purpose === "deuda"
      ? options.cards[0]
        ? `tarjeta:${options.cards[0].id}`
        : options.loans[0]
          ? `cuota:${options.loans[0].id}`
          : "ninguno"
      : "ninguno";

  const [apply, setApply] = useState(defaultApply);
  const applyChoices = [
    { value: "ninguno", label: "No, solo lo recibo", icon: "💰" },
    ...options.cards.map((c) => ({ value: `tarjeta:${c.id}`, label: `Pagar mi tarjeta ${c.name}`, icon: "💳" })),
    ...options.loans.map((l) => ({ value: `cuota:${l.id}`, label: `Pagar la siguiente cuota de ${l.name}`, icon: "📄" })),
    ...options.loans.map((l) => ({ value: `abono:${l.id}`, label: `Abonar a capital de ${l.name}`, icon: "💪" })),
  ];

  if (hidden) return null;

  return (
    <article aria-label={`Apoyo de ${item.senderName}`} className="flex flex-col gap-3 rounded-3xl border-4 border-ok bg-ok-bg p-5">
      <p className="text-xl font-bold leading-snug">
        <span aria-hidden="true">🤝 </span>
        {item.senderName} te envió <span className="tabular text-2xl text-ok">{formatMoney(item.amount)}</span> de apoyo
        {item.purpose === "deuda" ? " para pagar una deuda" : ""}.
      </p>
      <p className="text-base text-muted">
        {capitalize(formatDay(item.date))}
        {item.note ? ` · “${item.note}”` : ""}
      </p>

      {received ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface p-3">
          <p className="text-lg font-semibold text-ok">✅ Recibido. ¡Qué bien!</p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const r = await undoReceiveSupportAction(item.id);
                if (r.message) setUndoError(r.message);
                else setUndone(true);
              })
            }
            className="min-h-12 rounded-xl border-2 border-border bg-surface px-4 text-base font-semibold"
          >
            ↩️ Deshacer
          </button>
          {undoError && <Alert>{undoError}</Alert>}
        </div>
      ) : (
        <>
          <p className="text-xl font-semibold">¿Ya lo recibiste?</p>
          {state.message && <Alert>{state.message}</Alert>}
          {!open ? (
            <div className="grid grid-cols-1 gap-2">
              <Button type="button" onClick={() => setOpen(true)}>
                ✅ Sí, ya lo recibí
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    await snoozeSupportAction(item.id);
                    setHidden(true);
                  })
                }
              >
                ⏳ Todavía no
              </Button>
            </div>
          ) : (
            <form action={action} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-lg font-semibold">
                ¿A qué cuenta te llegó?
                <select name="accountId" defaultValue={money.find((a) => a.kind === "debito")?.id ?? money[0]?.id} className={selectCls}>
                  {money.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              {hasDebts && (
                <fieldset className="flex flex-col gap-2" role="radiogroup">
                  <legend className="mb-1 text-lg font-semibold">¿Lo usas para pagar algo?</legend>
                  <input type="hidden" name="apply" value={apply} />
                  {applyChoices.map((c) => (
                    <Choice key={c.value} selected={apply === c.value} onSelect={() => setApply(c.value)} icon={c.icon} title={c.label} />
                  ))}
                  {state.fieldErrors?.apply && <span className="text-base text-danger">⚠️ {state.fieldErrors.apply[0]}</span>}
                </fieldset>
              )}
              <Button type="submit" disabled={pending}>
                {pending ? "Guardando…" : "Confirmar que lo recibí"}
              </Button>
              <button type="button" onClick={() => setOpen(false)} className="min-h-12 text-base font-semibold text-primary underline">
                Regresar
              </button>
            </form>
          )}
        </>
      )}
    </article>
  );
}

export function SupportInbox({ items, options }: { items: InboxItem[]; options: ApplyOptions }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Apoyos por confirmar" className="mb-5 flex flex-col gap-3">
      {items.map((i) => (
        <InboxCard key={i.id} item={i} options={options} />
      ))}
    </section>
  );
}
