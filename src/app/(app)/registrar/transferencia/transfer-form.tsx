"use client";

import { useActionState, useState, useTransition } from "react";
import { createTransferAction, undoTransactionAction } from "@/server/actions/finance";
import { ACCOUNT_KIND_INFO } from "@/domain/accounts";
import { formatMoney, parseMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { initialFormState } from "@/lib/form-state";
import { MoneyKeypad } from "@/components/money-keypad";
import { Choice } from "@/components/choice";
import { Alert, Button, ButtonLink } from "@/components/ui";
import { StickyAction } from "@/components/sticky-action";
import type { AccountOption } from "../tx-wizard";

function detail(a: AccountOption) {
  return ACCOUNT_KIND_INFO[a.kind].isDebt
    ? `Debes ${formatMoney(Math.max(0, -a.balance))}`
    : `Tienes ${formatMoney(a.balance)}`;
}

/** Pasar dinero entre cuentas propias o pagar una tarjeta (no es gasto nuevo). */
export function TransferForm({
  accounts,
  today,
  defaultToId,
}: {
  accounts: AccountOption[];
  today: string;
  defaultToId: string | null;
}) {
  const sources = accounts.filter((a) => a.kind !== "credito" && a.kind !== "prestamo");
  const [step, setStep] = useState<1 | 2>(1);
  const [amount, setAmount] = useState("");
  const [fromId, setFromId] = useState(sources.find((a) => a.kind === "debito")?.id ?? sources[0]?.id ?? "");
  const [toId, setToId] = useState(defaultToId ?? "");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [state, formAction, pending] = useActionState(createTransferAction, initialFormState);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  const [undoing, startUndo] = useTransition();

  const cents = parseMoney(amount || "0") ?? 0;
  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);
  const isCardPayment = to?.kind === "credito";
  const savedId = state.data?.id;

  if (savedId && savedId !== savedKey) {
    return (
      <div className="flex flex-col gap-4">
        {undone ? (
          <Alert kind="warn">Listo, se deshizo. No se guardó nada.</Alert>
        ) : (
          <div role="status" className="rounded-2xl border-2 border-ok bg-ok-bg p-5">
            <p className="text-2xl font-bold text-ok">
              <span aria-hidden="true">✅ </span>
              {state.data?.kind === "pago_tarjeta" ? "Pago de tarjeta guardado" : "Movimiento guardado"}
            </p>
            <p className="mt-2 text-xl">
              <strong className="tabular">{formatMoney(cents)}</strong> de {from?.name} a {to?.name}.
            </p>
          </div>
        )}
        <Button
          type="button"
          onClick={() => {
            setSavedKey(savedId);
            setStep(1);
            setAmount("");
            setToId("");
            setNote("");
            setUndone(false);
          }}
        >
          Registrar otro
        </Button>
        <ButtonLink href="/cuentas" variant="secondary">
          <span aria-hidden="true">💳</span> Ver mis cuentas
        </ButtonLink>
        {!undone && (
          <Button
            type="button"
            variant="danger"
            disabled={undoing}
            onClick={() =>
              startUndo(async () => {
                const r = await undoTransactionAction(savedId);
                if (!r.message) setUndone(true);
              })
            }
          >
            <span aria-hidden="true">↩️</span> {undoing ? "Deshaciendo…" : "Deshacer (me equivoqué)"}
          </Button>
        )}
      </div>
    );
  }

  if (accounts.length < 2 || sources.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Alert kind="warn">Necesitas al menos dos cuentas (por ejemplo efectivo y débito) para pasar dinero.</Alert>
        <ButtonLink href="/cuentas/nueva">Agregar cuenta</ButtonLink>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="amount" value={amount} />
      <input type="hidden" name="fromAccountId" value={fromId} />
      <input type="hidden" name="toAccountId" value={toId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="note" value={note} />
      {state.message && <Alert>{state.message}</Alert>}
      {state.fieldErrors && (
        <Alert>{Object.values(state.fieldErrors).flat().filter(Boolean)[0] ?? "Revisa los datos."}</Alert>
      )}

      {step === 1 ? (
        <>
          <p className="text-base font-semibold text-muted">Paso 1 de 2</p>
          <h2 className="text-2xl font-bold">¿Cuánto dinero?</h2>
          <p className="text-base text-muted">
            Por ejemplo: sacar del cajero, pasar a tu ahorro o pagar tu tarjeta de crédito.
          </p>
          <MoneyKeypad value={amount} onChange={setAmount} label="Monto" />
          <StickyAction>
            <Button type="button" disabled={cents <= 0} onClick={() => setStep(2)}>
              Siguiente <span aria-hidden="true">→</span>
            </Button>
          </StickyAction>
        </>
      ) : (
        <>
          <p className="text-base font-semibold text-muted">Paso 2 de 2</p>
          <p className="rounded-2xl bg-surface-2 p-4 text-xl">
            <strong className="tabular">{formatMoney(cents)}</strong>
          </p>
          <h2 className="text-2xl font-bold">¿De dónde sale?</h2>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="De dónde sale">
            {sources.map((a) => (
              <Choice
                key={a.id}
                selected={a.id === fromId}
                onSelect={() => {
                  setFromId(a.id);
                  if (toId === a.id) setToId("");
                }}
                icon={ACCOUNT_KIND_INFO[a.kind].icon}
                title={a.name}
                detail={detail(a)}
              />
            ))}
          </div>
          <h2 className="text-2xl font-bold">¿A dónde va?</h2>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="A dónde va">
            {accounts
              .filter((a) => a.id !== fromId && a.kind !== "prestamo")
              .map((a) => (
                <Choice
                  key={a.id}
                  selected={a.id === toId}
                  onSelect={() => setToId(a.id)}
                  icon={ACCOUNT_KIND_INFO[a.kind].icon}
                  title={a.name}
                  detail={detail(a)}
                />
              ))}
          </div>
          {isCardPayment && (
            <Alert kind="ok">
              Esto es un <strong>pago de tarjeta</strong>. Baja lo que debes y no cuenta como gasto nuevo (el
              gasto ya se contó cuando compraste).
            </Alert>
          )}
          <label className="flex flex-col gap-1 text-lg font-semibold">
            Fecha {date === today ? "(hoy)" : `(${formatDay(date)})`}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || today)}
              className="min-h-14 rounded-xl border-2 border-border bg-surface px-3 text-lg"
            />
          </label>
          <label className="flex flex-col gap-1 text-lg font-semibold">
            Nota (opcional)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              className="min-h-14 rounded-xl border-2 border-border bg-surface px-3 text-lg font-normal"
            />
          </label>
          <StickyAction>
            <Button type="submit" disabled={pending || !fromId || !toId}>
              {pending ? "Guardando…" : isCardPayment ? "Guardar pago de tarjeta" : "Guardar"}
            </Button>
          </StickyAction>
          <Button type="button" variant="secondary" onClick={() => setStep(1)}>
            <span aria-hidden="true">←</span> Regresar
          </Button>
        </>
      )}
    </form>
  );
}
