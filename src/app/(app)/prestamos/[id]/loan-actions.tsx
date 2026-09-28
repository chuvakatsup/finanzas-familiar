"use client";

import { useActionState, useState, useTransition } from "react";
import { payLoanAction, prepayLoanAction, undoLoanPaymentAction } from "@/server/actions/credit";
import { capitalize } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { relativeDay } from "@/domain/recurrence";
import { initialFormState } from "@/lib/form-state";
import { ConfirmButton } from "@/components/confirm-button";
import { Alert, Button, TextField } from "@/components/ui";

type Account = { id: string; name: string };
const selectCls = "min-h-14 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg font-normal";

function AccountSelect({ accounts, defaultAccountId, label }: { accounts: Account[]; defaultAccountId: string | null; label: string }) {
  return (
    <label className="flex flex-col gap-1 text-lg font-semibold">
      {label}
      <select name="fromAccountId" defaultValue={defaultAccountId ?? accounts[0]?.id} className={selectCls}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Pagar la siguiente cuota (un toque) y deshacer el último pago. */
export function LoanActions({
  loanId,
  next,
  total,
  today,
  accounts,
  defaultAccountId,
  canUndo,
}: {
  loanId: string;
  next: { id: string; number: number; payment: number; dueDate: string; capital: number; interest: number } | null;
  total: number;
  today: string;
  accounts: Account[];
  defaultAccountId: string | null;
  canUndo: boolean;
}) {
  const [state, action, pending] = useActionState(payLoanAction, initialFormState);
  const [undoMsg, setUndoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [undoing, startUndo] = useTransition();
  const overdue = next && next.dueDate < today;

  return (
    <section className="mb-5 flex flex-col gap-3">
      {next && (
        <div className={`rounded-2xl border-2 bg-surface p-4 ${overdue ? "border-warn" : "border-border"}`}>
          <p className="text-lg text-muted">
            Siguiente: pago {next.number} de {total}
          </p>
          <p className="tabular text-3xl font-extrabold">{formatMoney(next.payment)}</p>
          <p className={`text-lg ${overdue ? "font-semibold text-warn" : ""}`}>
            {overdue && <span aria-hidden="true">⚠️ </span>}
            {relativeDay(next.dueDate, today)} · {capitalize(formatDay(next.dueDate))}
          </p>
          {next.interest > 0 && (
            <p className="text-base text-muted">
              {formatMoney(next.capital)} bajan tu deuda y {formatMoney(next.interest)} son intereses e IVA.
            </p>
          )}
          <form action={action} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="loanId" value={loanId} />
            <input type="hidden" name="rowId" value={next.id} />
            {state.message && <Alert>{state.message}</Alert>}
            {state.data?.done && <Alert kind="ok">Pago registrado.</Alert>}
            <AccountSelect accounts={accounts} defaultAccountId={defaultAccountId} label="¿Con qué pagaste?" />
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "✅ Ya pagué esta cuota"}
            </Button>
          </form>
        </div>
      )}
      {undoMsg && <Alert kind={undoMsg.ok ? "ok" : "danger"}>{undoMsg.text}</Alert>}
      {canUndo && (
        <button
          type="button"
          disabled={undoing}
          onClick={() =>
            startUndo(async () => {
              const r = await undoLoanPaymentAction(loanId);
              setUndoMsg(r.message ? { ok: false, text: r.message } : { ok: true, text: "Listo, se deshizo el último pago." });
            })
          }
          className="min-h-12 self-start text-base font-semibold text-primary underline underline-offset-4"
        >
          ↩️ {undoing ? "Deshaciendo…" : "Deshacer el último pago registrado"}
        </button>
      )}
    </section>
  );
}

/** Abono extra a capital con la opción de reducir plazo o cuota. */
export function PrepayForm({
  loanId,
  today,
  accounts,
  defaultAccountId,
  max,
}: {
  loanId: string;
  today: string;
  accounts: Account[];
  defaultAccountId: string | null;
  max: number;
}) {
  const [state, action, pending] = useActionState(prepayLoanAction.bind(null, loanId), initialFormState);
  const [mode, setMode] = useState<"plazo" | "cuota">("plazo");
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="mt-3 flex flex-col gap-4" noValidate key={state.data?.done}>
      <p className="text-base text-muted">Un abono baja directo lo que debes (sin intereses). Debes {formatMoney(max)}.</p>
      {state.message && <Alert>{state.message}</Alert>}
      {state.data?.done && <Alert kind="ok">Abono registrado. Recalculamos tu tabla.</Alert>}
      <input type="hidden" name="mode" value={mode} />
      <TextField label="¿Cuánto abonaste?" name="amount" inputMode="decimal" errors={e.amount} />
      <TextField label="Fecha" name="date" type="date" defaultValue={today} errors={e.date} />
      <AccountSelect accounts={accounts} defaultAccountId={defaultAccountId} label="¿Con qué pagaste?" />
      <fieldset>
        <legend className="mb-2 text-lg font-semibold">¿Qué prefieres?</legend>
        <div className="flex flex-col gap-2">
          {(
            [
              ["plazo", "Terminar antes", "Sigues pagando lo mismo, pero acabas antes (ahorras más intereses)."],
              ["cuota", "Pagar menos cada vez", "Mismo número de pagos, pero cada uno más bajo."],
            ] as const
          ).map(([v, title, help]) => (
            <button
              key={v}
              type="button"
              aria-pressed={mode === v}
              onClick={() => setMode(v)}
              className={`flex min-h-16 flex-col items-start rounded-2xl border-2 p-3 text-left ${mode === v ? "border-primary bg-surface-2" : "border-border bg-surface"}`}
            >
              <span className="text-lg font-semibold">
                {mode === v ? "✓ " : ""}
                {title}
              </span>
              <span className="text-base text-muted">{help}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <ConfirmButton
        title="¿Registrar el abono?"
        message={<p>Vamos a recalcular tus pagos que faltan. Si te equivocas, puedes deshacerlo.</p>}
        confirmLabel="Sí, registrar"
        variant="secondary"
      >
        {pending ? "Guardando…" : "Registrar abono"}
      </ConfirmButton>
    </form>
  );
}
