"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { welcomeAccountsAction, welcomeIncomeAction, welcomePaymentsAction } from "@/server/actions/welcome";
import { LAST_DAY } from "@/domain/recurrence";
import { COMMON_PAYMENTS } from "@/domain/welcome";
import { initialFormState } from "@/lib/form-state";
import { Alert, Button, TextField } from "@/components/ui";
import { StickyAction } from "@/components/sticky-action";

type Account = { id: string; name: string; kind: string };

const selectCls = "min-h-14 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg font-normal";

function Toggle({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-14 items-center gap-3 text-lg font-semibold">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-7 shrink-0 accent-[var(--primary)]"
      />
      {label}
    </label>
  );
}

function SkipLink({ to }: { to: string }) {
  return (
    <Link href={to} className="flex min-h-12 items-center justify-center text-lg font-semibold text-primary underline">
      Omitir este paso
    </Link>
  );
}

function DayOptions() {
  return (
    <>
      {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
      <option value={LAST_DAY}>Último día del mes</option>
    </>
  );
}

// ---------------- Paso 1 ----------------

export function MoneyStep() {
  const [state, action, pending] = useActionState(welcomeAccountsAction, initialFormState);
  const [hasBank, setHasBank] = useState(false);
  const [hasCard, setHasCard] = useState(false);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <h1 className="text-3xl font-bold">¿Dónde tienes tu dinero?</h1>
      {state.message && <Alert>{state.message}</Alert>}
      <TextField
        label="¿Cuánto efectivo tienes hoy?"
        hint="En la cartera o guardado en casa. Puedes dejarlo vacío."
        name="cash"
        inputMode="decimal"
        placeholder="0.00"
        errors={e.cash}
      />
      <div className="rounded-2xl border border-border bg-surface p-4">
        <Toggle name="hasBank" label="Tengo cuenta de banco o tarjeta de débito" checked={hasBank} onChange={setHasBank} />
        {hasBank && (
          <div className="mt-3 flex flex-col gap-4">
            <TextField label="Nombre del banco" name="bankName" placeholder="Ej. Banorte pensión" errors={e.bankName} />
            <TextField label="¿Cuánto tienes ahí?" name="bankBalance" inputMode="decimal" placeholder="0.00" errors={e.bankBalance} />
          </div>
        )}
      </div>
      <div className="rounded-2xl border border-border bg-surface p-4">
        <Toggle name="hasCard" label="Tengo tarjeta de crédito" checked={hasCard} onChange={setHasCard} />
        {hasCard && (
          <div className="mt-3 flex flex-col gap-4">
            <TextField label="Nombre de la tarjeta" name="cardName" placeholder="Ej. Liverpool" errors={e.cardName} />
            <TextField label="¿Cuánto debes hoy?" name="cardDebt" inputMode="decimal" placeholder="0.00" errors={e.cardDebt} />
            <TextField label="Día límite de pago (opcional)" name="cardDueDay" inputMode="numeric" placeholder="Ej. 25" errors={e.cardDueDay} />
          </div>
        )}
        <p className="mt-2 text-base text-muted">Nunca escribas números de tarjeta ni claves.</p>
      </div>
      <StickyAction>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Siguiente →"}
        </Button>
      </StickyAction>
      <SkipLink to="/bienvenida?paso=2" />
    </form>
  );
}

// ---------------- Paso 2 ----------------

const INCOME_NAMES = ["Pensión", "Sueldo"] as const;

export function IncomeStep({ accounts, today }: { accounts: Account[]; today: string }) {
  const [state, action, pending] = useActionState(welcomeIncomeAction, initialFormState);
  const [name, setName] = useState<string>("Pensión");
  const [frequency, setFrequency] = useState<"quincenal" | "mensual" | "semanal" | "ninguno">("quincenal");
  const [auto, setAuto] = useState(true);
  const e = state.fieldErrors ?? {};
  const defaultAccount = accounts.find((a) => a.kind === "debito")?.id ?? accounts[0]?.id;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <h1 className="text-3xl font-bold">¿Cuánto te llega?</h1>
      <p className="text-lg text-muted">Tu pensión, sueldo o el dinero que recibes seguido.</p>
      {state.message && <Alert>{state.message}</Alert>}
      <input type="hidden" name="frequency" value={frequency} />

      <fieldset>
        <legend className="mb-2 text-lg font-semibold">¿Cada cuándo?</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["quincenal", "Cada quincena"],
              ["mensual", "Cada mes"],
              ["semanal", "Cada semana"],
              ["ninguno", "No tengo ingreso fijo"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={frequency === v}
              onClick={() => setFrequency(v)}
              className={`min-h-14 rounded-2xl border-2 px-2 text-base font-semibold leading-tight ${
                frequency === v ? "border-primary bg-primary text-on-primary" : "border-border bg-surface"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      {frequency !== "ninguno" && (
        <>
          <fieldset>
            <legend className="mb-2 text-lg font-semibold">¿De qué es?</legend>
            <div className="flex flex-wrap gap-2">
              {INCOME_NAMES.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={name === n}
                  onClick={() => setName(n)}
                  className={`min-h-12 rounded-2xl border-2 px-4 text-lg font-semibold ${
                    name === n ? "border-primary bg-primary text-on-primary" : "border-border bg-surface"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </fieldset>
          <TextField label="Nombre" name="name" value={name} onChange={(ev) => setName(ev.target.value)} errors={e.name} />
          <TextField
            label={frequency === "quincenal" ? "¿Cuánto te llega cada quincena?" : "¿Cuánto te llega cada vez?"}
            name="amount"
            inputMode="decimal"
            placeholder="0.00"
            errors={e.amount}
          />
          {frequency === "quincenal" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-lg font-semibold">
                Primer día
                <select name="day1" defaultValue="15" className={selectCls}>
                  <DayOptions />
                </select>
              </label>
              <label className="flex flex-col gap-1 text-lg font-semibold">
                Segundo día
                <select name="day2" defaultValue={String(LAST_DAY)} className={selectCls}>
                  <DayOptions />
                </select>
              </label>
            </div>
          )}
          {frequency === "mensual" && (
            <label className="flex flex-col gap-1 text-lg font-semibold">
              ¿Qué día del mes?
              <select name="day1" defaultValue="1" className={selectCls}>
                <DayOptions />
              </select>
            </label>
          )}
          {frequency === "semanal" && (
            <TextField label="¿Cuándo te llega el próximo?" name="nextDate" type="date" defaultValue={today} />
          )}
          <label className="flex flex-col gap-1 text-lg font-semibold">
            ¿A dónde te llega?
            <select name="accountId" defaultValue={defaultAccount} className={selectCls}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <Toggle name="autoRegister" label="Me lo depositan automático" checked={auto} onChange={setAuto} />
        </>
      )}

      <StickyAction>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Siguiente →"}
        </Button>
      </StickyAction>
      <SkipLink to="/bienvenida?paso=3" />
    </form>
  );
}

// ---------------- Paso 3 ----------------

export function PaymentsStep({ accounts, today }: { accounts: Account[]; today: string }) {
  const [state, action, pending] = useActionState(welcomePaymentsAction, initialFormState);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const e = state.fieldErrors ?? {};
  const defaultAccount = accounts.find((a) => a.kind === "debito")?.id ?? accounts[0]?.id;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <h1 className="text-3xl font-bold">¿Qué pagas cada mes?</h1>
      <p className="text-lg text-muted">Palomea lo que pagas. Si el monto cambia, pon lo de un recibo normal.</p>
      {state.message && <Alert>{state.message}</Alert>}

      <div className="flex flex-col gap-3">
        {COMMON_PAYMENTS.map((p) => {
          const isOn = !!checked[p.key];
          return (
            <div key={p.key} className={`rounded-2xl border-2 bg-surface p-4 ${isOn ? "border-primary" : "border-border"}`}>
              <Toggle
                name={`${p.key}_on`}
                label={p.name}
                checked={isOn}
                onChange={(v) => setChecked((c) => ({ ...c, [p.key]: v }))}
              />
              {isOn && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <TextField
                    label={p.estimate ? "Más o menos" : "Monto"}
                    name={`${p.key}_amount`}
                    inputMode="decimal"
                    placeholder="0.00"
                    errors={e[`${p.key}_amount`]}
                  />
                  {p.frequency === "bimestral" ? (
                    <TextField
                      label="Próximo recibo"
                      name={`${p.key}_date`}
                      type="date"
                      defaultValue={today}
                      errors={e[`${p.key}_date`]}
                    />
                  ) : (
                    <label className="flex flex-col gap-1 text-lg font-semibold">
                      Día de pago
                      <select name={`${p.key}_day`} defaultValue="1" className={selectCls}>
                        <DayOptions />
                      </select>
                    </label>
                  )}
                  {p.frequency === "bimestral" && (
                    <p className="col-span-2 text-base text-muted">La luz llega cada 2 meses.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <label className="flex flex-col gap-1 text-lg font-semibold">
        ¿Con qué los pagas normalmente?
        <select name="accountId" defaultValue={defaultAccount} className={selectCls}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {e.accountId && <span className="text-base text-danger">⚠️ {e.accountId[0]}</span>}
      </label>
      <p className="text-base text-muted">Después puedes agregar más en Más → Pagos fijos.</p>

      <StickyAction>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Terminar"}
        </Button>
      </StickyAction>
      <SkipLink to="/bienvenida?paso=listo" />
    </form>
  );
}
