"use client";

import { useActionState, useState, useTransition } from "react";
import {
  confirmOccurrenceAction,
  skipOccurrenceAction,
  undoOccurrenceAction,
} from "@/server/actions/scheduled";
import type { DueItem } from "@/server/services/scheduled";
import { capitalize } from "@/domain/dates";
import { centsToInput, formatMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { diffDays, relativeDay } from "@/domain/recurrence";
import { initialFormState } from "@/lib/form-state";
import { ConfirmButton } from "./confirm-button";
import { Alert, Button, TextField } from "./ui";

type AccountOption = { id: string; name: string; kind: string };

/**
 * Un pago o ingreso programado en una fecha: muestra cuándo toca y permite confirmarlo con un toque,
 * cambiar el monto (si es aproximado), saltarlo o deshacer.
 */
export function DueCard({
  due,
  today,
  accounts,
}: {
  due: DueItem;
  today: string;
  accounts: AccountOption[];
}) {
  const isPago = due.kind === "pago";
  const [expanded, setExpanded] = useState(false);
  const [confirmState, confirmAction, confirming] = useActionState(confirmOccurrenceAction, initialFormState);
  const [skipState, skipAction, skipping] = useActionState(skipOccurrenceAction, initialFormState);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoing, startUndo] = useTransition();

  const days = diffDays(due.dueDate, today);
  const overdue = due.status === "pendiente" && days < 0;
  const when = `${relativeDay(due.dueDate, today)} · ${capitalize(formatDay(due.dueDate))}`;
  const sign = isPago ? "−" : "+";
  const tone = isPago ? "text-danger" : "text-ok";
  const accountOptions = isPago ? accounts : accounts.filter((a) => a.kind !== "credito" && a.kind !== "prestamo");

  const hidden = (
    <>
      <input type="hidden" name="itemId" value={due.itemId} />
      <input type="hidden" name="dueDate" value={due.dueDate} />
    </>
  );

  const undo = () =>
    startUndo(async () => {
      const r = await undoOccurrenceAction(due.itemId, due.dueDate);
      setUndoError(r.message ?? null);
    });

  return (
    <article
      aria-label={`${due.name}, ${when}`}
      className={`flex flex-col gap-3 rounded-2xl border-2 bg-surface p-4 ${
        overdue ? "border-warn" : due.status === "confirmado" ? "border-ok" : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-3xl">
          {due.categoryIcon ?? (isPago ? "🧾" : "💰")}
        </span>
        {/* Todo en una columna: a 360px el nombre y la fecha necesitan el ancho completo. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="wrap-break-word text-xl font-semibold leading-snug">{due.name}</h3>
          <p className={`tabular text-2xl font-bold ${tone}`}>
            <span className="sr-only">{isPago ? "pago de" : "ingreso de"} </span>
            <span aria-hidden="true">{sign}</span>
            {formatMoney(due.actualAmount ?? due.amount)}
            {due.amountIsEstimate && due.status !== "confirmado" && (
              <span className="ml-2 text-base font-normal text-muted">aprox.</span>
            )}
          </p>
          <p className={`text-base ${overdue ? "font-semibold text-warn" : "text-muted"}`}>
            {overdue && <span aria-hidden="true">⚠️ </span>}
            {when}
          </p>
          <p className="text-base text-muted">
            {isPago ? "Con " : "A "}
            {due.accountName}
            {due.autoRegister && " · automático"}
          </p>
        </div>
      </div>

      {due.status === "confirmado" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-ok-bg p-3">
          <p className="text-lg font-semibold text-ok">
            <span aria-hidden="true">✅ </span>
            {isPago ? "Pagado" : "Recibido"}
          </p>
          <button
            type="button"
            onClick={undo}
            disabled={undoing}
            className="min-h-12 rounded-xl border-2 border-border bg-surface px-4 text-base font-semibold"
          >
            ↩️ {undoing ? "Deshaciendo…" : "Deshacer"}
          </button>
        </div>
      )}

      {due.status === "omitido" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 p-3">
          <p className="text-lg text-muted">Saltado esta vez</p>
          <button
            type="button"
            onClick={undo}
            disabled={undoing}
            className="min-h-12 rounded-xl border-2 border-border bg-surface px-4 text-base font-semibold"
          >
            ↩️ {undoing ? "Deshaciendo…" : "Deshacer"}
          </button>
        </div>
      )}

      {undoError && <Alert>{undoError}</Alert>}

      {due.status === "pendiente" && (
        <>
          {confirmState.message && <Alert>{confirmState.message}</Alert>}
          {skipState.message && <Alert>{skipState.message}</Alert>}

          <form action={confirmAction} className="flex flex-col gap-3">
            {hidden}
            {expanded || due.amountIsEstimate ? (
              <>
                <TextField
                  label={isPago ? "¿Cuánto pagaste?" : "¿Cuánto te llegó?"}
                  name="amount"
                  inputMode="decimal"
                  defaultValue={centsToInput(due.amount)}
                  errors={confirmState.fieldErrors?.amount}
                />
                {expanded && accountOptions.length > 1 && (
                  <label className="flex flex-col gap-1 text-lg font-semibold">
                    {isPago ? "¿Con qué pagaste?" : "¿A dónde entró?"}
                    <select
                      name="accountId"
                      defaultValue={due.accountId}
                      className="min-h-14 rounded-xl border-2 border-border bg-surface px-3 text-lg font-normal"
                    >
                      {accountOptions.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            ) : null}
            <Button type="submit" disabled={confirming}>
              {confirming ? "Guardando…" : isPago ? "✅ Ya lo pagué" : "✅ Ya me pagaron"}
            </Button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-x-4">
            {!expanded && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="min-h-12 text-base font-semibold text-primary underline underline-offset-4"
              >
                Otro monto o cuenta
              </button>
            )}
            <form action={skipAction} className="ml-auto">
              {hidden}
              <SkipButton isPago={isPago} busy={skipping} />
            </form>
          </div>
        </>
      )}
    </article>
  );
}

function SkipButton({ isPago, busy }: { isPago: boolean; busy: boolean }) {
  return (
    <ConfirmButton
      look="link"
      title="¿Saltar esta vez?"
      message={
        <p>
          Úsalo si {isPago ? "este pago no aplica" : "este ingreso no llegó o no aplica"} esta vez, o si ya lo
          habías anotado a mano. No se registra ningún movimiento.
        </p>
      }
      confirmLabel="Sí, saltar"
      variant="secondary"
    >
      {busy ? "…" : "No aplica esta vez"}
    </ConfirmButton>
  );
}
