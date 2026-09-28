"use client";

import { useActionState, useState } from "react";
import { createScheduledAction, updateScheduledAction } from "@/server/actions/scheduled";
import { FREQUENCIES, FREQUENCY_INFO, type Frequency, LAST_DAY } from "@/domain/recurrence";
import { type FormState, initialFormState } from "@/lib/form-state";
import { Alert, Button, TextField } from "@/components/ui";

type Option = { id: string; name: string };

export type ScheduledFormValues = {
  id?: string;
  name: string;
  amount: string;
  amountIsEstimate: boolean;
  frequency: Frequency | null;
  nextDate: string;
  day1: number;
  day2: number;
  accountId: string;
  categoryId: string;
  autoRegister: boolean;
};

const selectCls = "min-h-14 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg";

function DaySelect({ name, label, value, onChange }: { name: string; label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-lg font-semibold">
      {label}
      <select name={name} value={value} onChange={(e) => onChange(Number(e.target.value))} className={selectCls}>
        {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
        <option value={LAST_DAY}>Último día del mes</option>
      </select>
    </label>
  );
}

/** Alta/edición de un ingreso fijo o un pago recurrente. */
export function ScheduledForm({
  kind,
  values,
  accounts,
  categories,
  today,
}: {
  kind: "ingreso" | "pago";
  values: ScheduledFormValues;
  accounts: Option[];
  categories: (Option & { icon: string })[];
  today: string;
}) {
  const isPago = kind === "pago";
  const [frequency, setFrequency] = useState<Frequency | null>(values.frequency);
  const [day1, setDay1] = useState(values.day1);
  const [day2, setDay2] = useState(values.day2);
  const action = values.id
    ? updateScheduledAction.bind(null, values.id)
    : (createScheduledAction as (s: FormState, f: FormData) => Promise<FormState>);
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="frequency" value={frequency ?? ""} />
      {state.message && <Alert>{state.message}</Alert>}

      <TextField
        label="Nombre"
        name="name"
        defaultValue={values.name}
        placeholder={isPago ? "Ej. Luz CFE, Renta, Netflix" : "Ej. Pensión IMSS, Sueldo"}
        maxLength={40}
        errors={e.name}
      />

      <div className="flex flex-col gap-2">
        <TextField
          label={isPago ? "¿Cuánto pagas?" : "¿Cuánto recibes?"}
          name="amount"
          inputMode="decimal"
          placeholder="0.00"
          defaultValue={values.amount}
          errors={e.amount}
        />
        <label className="flex min-h-12 items-center gap-3 text-lg">
          <input
            type="checkbox"
            name="amountIsEstimate"
            defaultChecked={values.amountIsEstimate}
            className="size-7 accent-[var(--primary)]"
          />
          El monto cambia cada vez (es aproximado)
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 text-lg font-semibold">¿Cada cuándo?</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {FREQUENCIES.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={frequency === f}
              onClick={() => setFrequency(f)}
              className={`min-h-14 rounded-2xl border-2 px-2 text-base font-semibold leading-tight ${
                frequency === f ? "border-primary bg-primary text-on-primary" : "border-border bg-surface"
              }`}
            >
              {FREQUENCY_INFO[f].label}
            </button>
          ))}
        </div>
        {e.frequency && <p className="mt-1 text-base text-danger">⚠️ {e.frequency[0]}</p>}
        {frequency && <p className="mt-2 text-base text-muted">{FREQUENCY_INFO[frequency].help}</p>}
      </fieldset>

      {frequency === "mensual" && (
        <>
          <DaySelect name="day1" label="¿Qué día del mes?" value={day1} onChange={setDay1} />
          {e.day1 && <p className="text-base text-danger">⚠️ {e.day1[0]}</p>}
        </>
      )}
      {frequency === "quincenal" && (
        <div className="grid grid-cols-2 gap-3">
          <DaySelect name="day1" label="Primer día" value={day1} onChange={setDay1} />
          <DaySelect name="day2" label="Segundo día" value={day2} onChange={setDay2} />
          {(e.day1 || e.day2) && (
            <p className="col-span-2 text-base text-danger">⚠️ {(e.day1 ?? e.day2)![0]}</p>
          )}
        </div>
      )}
      {frequency && frequency !== "mensual" && frequency !== "quincenal" && (
        <TextField
          label={frequency === "unica" ? "¿Qué día?" : "¿Cuándo toca el próximo?"}
          name="nextDate"
          type="date"
          defaultValue={values.nextDate || today}
          errors={e.nextDate}
        />
      )}

      <label className="flex flex-col gap-1 text-lg font-semibold">
        {isPago ? "¿Con qué se paga?" : "¿A qué cuenta llega?"}
        <select name="accountId" defaultValue={values.accountId} className={selectCls}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {e.accountId && <span className="text-base text-danger">⚠️ {e.accountId[0]}</span>}
      </label>

      <label className="flex flex-col gap-1 text-lg font-semibold">
        Categoría
        <select name="categoryId" defaultValue={values.categoryId} className={selectCls}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
        {e.categoryId && <span className="text-base text-danger">⚠️ {e.categoryId[0]}</span>}
      </label>

      <label className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 text-lg">
        <input
          type="checkbox"
          name="autoRegister"
          defaultChecked={values.autoRegister}
          className="mt-1 size-7 shrink-0 accent-[var(--primary)]"
        />
        <span>
          <strong>{isPago ? "Se cobra solo (domiciliado)" : "Me lo depositan automático"}</strong>
          <span className="block text-base text-muted">
            Se anotará solo cada vez que llegue la fecha. Si el monto cambia, lo puedes corregir después.
          </span>
        </span>
      </label>

      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
