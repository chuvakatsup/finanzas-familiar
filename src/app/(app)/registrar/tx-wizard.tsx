"use client";

import { useActionState, useState, useTransition } from "react";
import { createExpenseAction, createIncomeAction, undoTransactionAction } from "@/server/actions/finance";
import { ACCOUNT_KIND_INFO, type AccountKind } from "@/domain/accounts";
import { formatMoney, parseMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { initialFormState } from "@/lib/form-state";
import { MoneyKeypad } from "@/components/money-keypad";
import { Choice } from "@/components/choice";
import { Alert, Button, ButtonLink } from "@/components/ui";
import { StickyAction } from "@/components/sticky-action";

export type AccountOption = { id: string; name: string; kind: AccountKind; balance: number };
export type CategoryOption = { id: string; name: string; icon: string };

const TEXT = {
  gasto: {
    amount: "¿Cuánto gastaste?",
    category: "¿En qué fue?",
    account: "¿Con qué pagaste?",
    save: "Guardar gasto",
    done: "Gasto guardado",
    again: "Registrar otro gasto",
  },
  ingreso: {
    amount: "¿Cuánto recibiste?",
    category: "¿De qué es?",
    account: "¿A dónde entró?",
    save: "Guardar ingreso",
    done: "Ingreso guardado",
    again: "Registrar otro ingreso",
  },
} as const;

function accountDetail(a: AccountOption) {
  if (ACCOUNT_KIND_INFO[a.kind].isDebt) return `Debes ${formatMoney(Math.max(0, -a.balance))}`;
  return `Tienes ${formatMoney(a.balance)}`;
}

/**
 * Registrar en 3 pasos: 1) monto  2) categoría (un toque avanza)  3) cuenta (ya viene elegida) → Guardar.
 */
export function TxWizard({
  kind,
  categories,
  accounts,
  defaultAccountId,
  today,
}: {
  kind: "gasto" | "ingreso";
  categories: CategoryOption[];
  accounts: AccountOption[];
  defaultAccountId: string | null;
  today: string;
}) {
  const t = TEXT[kind];
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [editDate, setEditDate] = useState(false);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [state, formAction, pending] = useActionState(
    kind === "gasto" ? createExpenseAction : createIncomeAction,
    initialFormState,
  );
  // Resultado guardado (se "congela" para la pantalla de éxito).
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoing, startUndo] = useTransition();

  const cents = parseMoney(amount || "0") ?? 0;
  const category = categories.find((c) => c.id === categoryId);
  const account = accounts.find((a) => a.id === accountId);
  const savedId = state.data?.id;

  function reset() {
    setStep(1);
    setAmount("");
    setCategoryId(null);
    setNote("");
    setShowNote(false);
    setEditDate(false);
    setDate(today);
    setUndone(false);
    setUndoError(null);
    setSavedKey(savedId ?? null);
  }

  // ---------- Pantalla de éxito ----------
  if (savedId && savedId !== savedKey) {
    return (
      <div className="flex flex-col gap-4">
        {undone ? (
          <Alert kind="warn">Listo, se deshizo. No se guardó nada.</Alert>
        ) : (
          <div role="status" className="rounded-2xl border-2 border-ok bg-ok-bg p-5 text-ok">
            <p className="text-2xl font-bold">
              <span aria-hidden="true">✅ </span>
              {t.done}
            </p>
            <p className="mt-2 text-xl text-text">
              <strong className="tabular">{formatMoney(cents)}</strong> en {category?.icon} {category?.name}
              {kind === "gasto" ? ", pagado con " : ", entró a "}
              {account?.name}.
            </p>
          </div>
        )}
        {undoError && <Alert>{undoError}</Alert>}
        <Button type="button" onClick={reset}>
          <span aria-hidden="true">➕</span> {undone ? "Volver a registrar" : t.again}
        </Button>
        <ButtonLink href="/" variant="secondary">
          <span aria-hidden="true">🏠</span> Ir a inicio
        </ButtonLink>
        {!undone && (
          <Button
            type="button"
            variant="danger"
            disabled={undoing}
            onClick={() =>
              startUndo(async () => {
                const r = await undoTransactionAction(savedId);
                if (r.message) setUndoError(r.message);
                else setUndone(true);
              })
            }
          >
            <span aria-hidden="true">↩️</span> {undoing ? "Deshaciendo…" : "Deshacer (me equivoqué)"}
          </Button>
        )}
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Alert kind="warn">
          {kind === "ingreso"
            ? "Primero agrega una cuenta de efectivo o débito para guardar tus ingresos."
            : "Primero agrega una cuenta (efectivo o tarjeta)."}
        </Alert>
        <ButtonLink href="/cuentas/nueva">Agregar cuenta</ButtonLink>
      </div>
    );
  }

  const stepLabel = <p className="text-base font-semibold text-muted">Paso {step} de 3</p>;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="amount" value={amount} />
      <input type="hidden" name="categoryId" value={categoryId ?? ""} />
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="note" value={note} />

      {state.message && <Alert>{state.message}</Alert>}
      {state.fieldErrors && (
        <Alert>{Object.values(state.fieldErrors).flat().filter(Boolean)[0] ?? "Revisa los datos."}</Alert>
      )}

      {step === 1 && (
        <>
          {stepLabel}
          <h2 className="text-2xl font-bold">{t.amount}</h2>
          <MoneyKeypad value={amount} onChange={setAmount} label={t.amount} />
          <StickyAction>
            <Button type="button" disabled={cents <= 0} onClick={() => setStep(2)}>
              Siguiente <span aria-hidden="true">→</span>
            </Button>
          </StickyAction>
        </>
      )}

      {step === 2 && (
        <>
          {stepLabel}
          <h2 className="text-2xl font-bold">
            {t.category} <span className="tabular text-muted">({formatMoney(cents)})</span>
          </h2>
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={t.category}>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={categoryId === c.id}
                onClick={() => {
                  setCategoryId(c.id);
                  setStep(3);
                }}
                className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 p-2 text-center ${
                  categoryId === c.id ? "border-primary bg-surface-2" : "border-border bg-surface"
                }`}
              >
                <span aria-hidden="true" className="text-4xl">
                  {c.icon}
                </span>
                <span className="text-lg font-semibold leading-tight">{c.name}</span>
              </button>
            ))}
          </div>
          <Button type="button" variant="secondary" onClick={() => setStep(1)}>
            <span aria-hidden="true">←</span> Regresar
          </Button>
        </>
      )}

      {step === 3 && (
        <>
          {stepLabel}
          <p className="rounded-2xl bg-surface-2 px-4 py-3 text-xl">
            <strong className="tabular">{formatMoney(cents)}</strong> en {category?.icon} {category?.name}
          </p>
          <h2 className="text-2xl font-bold">{t.account}</h2>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={t.account}>
            {accounts.map((a) => (
              <Choice
                key={a.id}
                selected={a.id === accountId}
                onSelect={() => setAccountId(a.id)}
                icon={ACCOUNT_KIND_INFO[a.kind].icon}
                title={a.name}
                detail={accountDetail(a)}
              />
            ))}
          </div>

          {kind === "gasto" && account?.kind === "credito" && (
            <a
              href={`/msi/nueva?tarjeta=${account.id}&monto=${encodeURIComponent(amount)}`}
              className="flex min-h-12 items-center text-base font-semibold text-primary underline underline-offset-4"
            >
              <span aria-hidden="true">🗓️&nbsp;</span>¿Fue a meses? Regístrala como compra a meses
            </a>
          )}
          {/* Fecha y nota: compactas para que "Guardar" quede a la vista. */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-4">
              <p className="text-lg">
                <span aria-hidden="true">📅 </span>
                {date === today ? "Hoy" : formatDay(date)}
              </p>
              {!editDate && (
                <button
                  type="button"
                  onClick={() => setEditDate(true)}
                  className="min-h-12 text-base font-semibold text-primary underline underline-offset-4"
                >
                  Cambiar fecha
                </button>
              )}
              {!showNote && (
                <button
                  type="button"
                  onClick={() => setShowNote(true)}
                  className="min-h-12 text-base font-semibold text-primary underline underline-offset-4"
                >
                  Agregar nota
                </button>
              )}
            </div>
            {editDate && (
              <label className="flex flex-col gap-1 text-lg font-semibold">
                Fecha
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value || today)}
                  className="min-h-14 rounded-xl border-2 border-border bg-surface px-3 text-lg"
                />
              </label>
            )}
            {showNote && (
              <label className="flex flex-col gap-1 text-lg font-semibold">
                Nota (opcional)
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  placeholder="Ej. farmacia del centro"
                  className="min-h-14 rounded-xl border-2 border-border bg-surface px-3 text-lg font-normal"
                />
              </label>
            )}
          </div>

          <StickyAction>
            <Button type="submit" disabled={pending || !accountId}>
              {pending ? "Guardando…" : t.save}
            </Button>
          </StickyAction>
          <Button type="button" variant="secondary" onClick={() => setStep(2)}>
            <span aria-hidden="true">←</span> Regresar
          </Button>
        </>
      )}

    </form>
  );
}
