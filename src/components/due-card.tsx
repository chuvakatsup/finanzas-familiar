"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import {
  confirmOccurrenceAction,
  skipOccurrenceAction,
  undoOccurrenceAction,
} from "@/server/actions/scheduled";
import { payLoanAction, undoLoanPaymentAction } from "@/server/actions/credit";
import type { DueItem } from "@/server/services/scheduled";
import type { FormState } from "@/lib/form-state";
import { capitalize } from "@/domain/dates";
import { centsToInput, formatMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { diffDays, relativeDay } from "@/domain/recurrence";
import { initialFormState } from "@/lib/form-state";
import { ConfirmButton } from "./confirm-button";
import { Alert, Button, ButtonLink, TextField } from "./ui";

type AccountOption = { id: string; name: string; kind: string };

const selectCls = "min-h-14 rounded-xl border-2 border-border bg-surface px-3 text-lg font-normal";

/**
 * Algo que toca pagar o recibir en una fecha: pago/ingreso programado, cuota de préstamo o pago
 * de tarjeta. Muestra cuándo toca y permite confirmarlo con un toque (y deshacer).
 */
export function DueCard({ due, today, accounts }: { due: DueItem; today: string; accounts: AccountOption[] }) {
  const isPago = due.kind === "pago";
  const overdue = due.status === "pendiente" && diffDays(due.dueDate, today) < 0;
  const when = `${relativeDay(due.dueDate, today)} · ${capitalize(formatDay(due.dueDate))}`;
  const tone = isPago ? "text-danger" : "text-ok";

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
          {due.detail && <p className="text-base text-muted">{due.detail}</p>}
          <p className={`tabular text-2xl font-bold ${tone}`}>
            <span className="sr-only">{isPago ? "pago de" : "ingreso de"} </span>
            <span aria-hidden="true">{isPago ? "−" : "+"}</span>
            {formatMoney(due.actualAmount ?? due.amount)}
            {due.amountIsEstimate && due.status !== "confirmado" && (
              <span className="ml-2 text-base font-normal text-muted">aprox.</span>
            )}
          </p>
          <p className={`text-base ${overdue ? "font-semibold text-warn" : "text-muted"}`}>
            {overdue && <span aria-hidden="true">⚠️ </span>}
            {due.source === "tarjeta" ? `Fecha límite: ${when}` : when}
          </p>
          {due.source !== "tarjeta" && (
            <p className="text-base text-muted">
              {isPago ? "Con " : "A "}
              {due.accountName}
              {due.autoRegister && " · automático"}
            </p>
          )}
        </div>
      </div>

      {due.source === "programado" && <ScheduledBody due={due} accounts={accounts} />}
      {due.source === "prestamo" && <LoanBody due={due} accounts={accounts} />}
      {due.source === "tarjeta" && (
        <div className="flex flex-col gap-2">
          <ButtonLink href={`/registrar/transferencia?a=${due.itemId}`}>💳 Registrar pago de la tarjeta</ButtonLink>
          <Link href={`/cuentas/${due.itemId}`} className="flex min-h-12 items-center text-base font-semibold text-primary underline">
            Ver pago mínimo y detalles
          </Link>
        </div>
      )}
    </article>
  );
}

function DoneBar({ label, tone, onUndo, undoing }: { label: string; tone: "ok" | "muted"; onUndo: () => void; undoing: boolean }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl p-3 ${tone === "ok" ? "bg-ok-bg" : "bg-surface-2"}`}>
      <p className={`text-lg font-semibold ${tone === "ok" ? "text-ok" : "text-muted"}`}>
        {tone === "ok" && <span aria-hidden="true">✅ </span>}
        {label}
      </p>
      <button
        type="button"
        onClick={onUndo}
        disabled={undoing}
        className="min-h-12 rounded-xl border-2 border-border bg-surface px-4 text-base font-semibold"
      >
        ↩️ {undoing ? "Deshaciendo…" : "Deshacer"}
      </button>
    </div>
  );
}

function useUndo(fn: () => Promise<FormState>) {
  const [error, setError] = useState<string | null>(null);
  const [undoing, start] = useTransition();
  const undo = () =>
    start(async () => {
      const r = await fn();
      setError(r.message ?? null);
    });
  return { error, undoing, undo };
}

/** Pago/ingreso programado: "Ya lo pagué", otro monto/cuenta, "No aplica esta vez". */
function ScheduledBody({ due, accounts }: { due: DueItem; accounts: AccountOption[] }) {
  const isPago = due.kind === "pago";
  const [expanded, setExpanded] = useState(false);
  const [confirmState, confirmAction, confirming] = useActionState(confirmOccurrenceAction, initialFormState);
  const [skipState, skipAction, skipping] = useActionState(skipOccurrenceAction, initialFormState);
  const { error, undoing, undo } = useUndo(() => undoOccurrenceAction(due.itemId, due.dueDate));
  const accountOptions = isPago ? accounts : accounts.filter((a) => a.kind !== "credito" && a.kind !== "prestamo");
  const hidden = (
    <>
      <input type="hidden" name="itemId" value={due.itemId} />
      <input type="hidden" name="dueDate" value={due.dueDate} />
    </>
  );

  if (due.status !== "pendiente") {
    return (
      <>
        <DoneBar
          label={due.status === "omitido" ? "Saltado esta vez" : isPago ? "Pagado" : "Recibido"}
          tone={due.status === "omitido" ? "muted" : "ok"}
          onUndo={undo}
          undoing={undoing}
        />
        {error && <Alert>{error}</Alert>}
      </>
    );
  }

  return (
    <>
      {confirmState.message && <Alert>{confirmState.message}</Alert>}
      {skipState.message && <Alert>{skipState.message}</Alert>}
      <form action={confirmAction} className="flex flex-col gap-3">
        {hidden}
        {(expanded || due.amountIsEstimate) && (
          <TextField
            label={isPago ? "¿Cuánto pagaste?" : "¿Cuánto te llegó?"}
            name="amount"
            inputMode="decimal"
            defaultValue={centsToInput(due.amount)}
            errors={confirmState.fieldErrors?.amount}
          />
        )}
        {expanded && accountOptions.length > 1 && (
          <label className="flex flex-col gap-1 text-lg font-semibold">
            {isPago ? "¿Con qué pagaste?" : "¿A dónde entró?"}
            <select name="accountId" defaultValue={due.accountId} className={selectCls}>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
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
            {skipping ? "…" : "No aplica esta vez"}
          </ConfirmButton>
        </form>
      </div>
    </>
  );
}

/** Cuota de préstamo: "Ya pagué la cuota" (con qué cuenta) y deshacer. */
function LoanBody({ due, accounts }: { due: DueItem; accounts: AccountOption[] }) {
  const [state, action, pending] = useActionState(payLoanAction, initialFormState);
  const { error, undoing, undo } = useUndo(() => undoLoanPaymentAction(due.itemId));
  const payable = accounts.filter((a) => a.kind !== "credito" && a.kind !== "prestamo");

  if (due.status !== "pendiente") {
    return (
      <>
        <DoneBar label="Cuota pagada" tone="ok" onUndo={undo} undoing={undoing} />
        {error && <Alert>{error}</Alert>}
      </>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="loanId" value={due.itemId} />
      <input type="hidden" name="rowId" value={due.rowId ?? ""} />
      {state.message && <Alert>{state.message}</Alert>}
      {payable.length > 1 && (
        <label className="flex flex-col gap-1 text-lg font-semibold">
          ¿Con qué pagaste?
          <select name="fromAccountId" defaultValue={due.accountId || payable[0]?.id} className={selectCls}>
            {payable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "✅ Ya pagué la cuota"}
      </Button>
      <Link href={`/prestamos/${due.itemId}`} className="flex min-h-12 items-center text-base font-semibold text-primary underline">
        Ver tabla del préstamo
      </Link>
    </form>
  );
}
