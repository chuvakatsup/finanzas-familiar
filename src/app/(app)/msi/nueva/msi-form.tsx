"use client";

import { useActionState, useState } from "react";
import { createMsiAction } from "@/server/actions/credit";
import { formatMoney, parseMoney, splitEvenly } from "@/domain/money";
import { initialFormState } from "@/lib/form-state";
import { Alert, Button, TextField } from "@/components/ui";
import { StickyAction } from "@/components/sticky-action";

const MONTH_CHOICES = [3, 6, 9, 12, 18, 24] as const;
const selectCls = "min-h-14 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg font-normal";

export function MsiForm({
  today,
  cards,
  defaultCardId,
  defaultAmount,
  categories,
}: {
  today: string;
  cards: { id: string; name: string }[];
  defaultCardId: string;
  defaultAmount: string;
  categories: { id: string; name: string; icon: string }[];
}) {
  const [state, action, pending] = useActionState(createMsiAction, initialFormState);
  const [amount, setAmount] = useState(defaultAmount);
  const [months, setMonths] = useState("12");
  const [withInterest, setWithInterest] = useState(false);
  const [started, setStarted] = useState(false);
  const e = state.fieldErrors ?? {};
  const cents = parseMoney(amount) ?? 0;
  const n = Number(months);
  const preview = !withInterest && cents > 0 && Number.isInteger(n) && n >= 2 ? splitEvenly(cents, n)[0] : null;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.message && <Alert>{state.message}</Alert>}

      <label className="flex flex-col gap-1 text-lg font-semibold">
        ¿Con qué tarjeta?
        <select name="cardAccountId" defaultValue={defaultCardId} className={selectCls}>
          {cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <TextField label="¿Qué compraste?" name="description" placeholder="Ej. Refrigerador" maxLength={60} errors={e.description} />

      <label className="flex flex-col gap-1 text-lg font-semibold">
        Categoría
        <select name="categoryId" defaultValue={categories.find((c) => c.name === "Casa")?.id} className={selectCls}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
      </label>

      <TextField
        label="Precio total de la compra"
        name="principal"
        inputMode="decimal"
        placeholder="0.00"
        value={amount}
        onChange={(ev) => setAmount(ev.target.value)}
        errors={e.principal}
      />

      <fieldset>
        <legend className="mb-2 text-lg font-semibold">¿A cuántos meses?</legend>
        <div className="grid grid-cols-3 gap-2">
          {MONTH_CHOICES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={months === String(m)}
              onClick={() => setMonths(String(m))}
              className={`min-h-14 rounded-2xl border-2 text-lg font-semibold ${
                months === String(m) ? "border-primary bg-primary text-on-primary" : "border-border bg-surface"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <TextField label="Otro número de meses" name="months" inputMode="numeric" value={months} onChange={(ev) => setMonths(ev.target.value)} errors={e.months} />
      </fieldset>

      {preview != null && (
        <p className="rounded-2xl bg-surface-2 p-4 text-xl">
          Serán <strong>{n}</strong> pagos de <strong className="tabular">{formatMoney(preview)}</strong>
        </p>
      )}

      <div className="rounded-2xl border border-border bg-surface p-4">
        <label className="flex min-h-12 items-center gap-3 text-lg font-semibold">
          <input type="checkbox" name="withInterest" checked={withInterest} onChange={(ev) => setWithInterest(ev.target.checked)} className="size-7 shrink-0 accent-[var(--primary)]" />
          Es a meses CON intereses
        </label>
        {withInterest && (
          <div className="mt-3 flex flex-col gap-4">
            <TextField label="Tasa de interés anual (%)" name="annualRateBp" inputMode="decimal" placeholder="Ej. 36" errors={e.annualRateBp} />
            <label className="flex flex-col gap-1 text-lg font-semibold">
              IVA sobre intereses
              <select name="ivaPct" defaultValue="16" className={selectCls}>
                <option value="16">Sí, 16%</option>
                <option value="0">No</option>
              </select>
            </label>
          </div>
        )}
      </div>

      <TextField label="Fecha de la compra" name="purchaseDate" type="date" defaultValue={today} errors={e.purchaseDate} />
      <TextField
        label="Fecha de la primera mensualidad (opcional)"
        hint="Si la dejas vacía la calculamos con el corte y la fecha de pago de tu tarjeta."
        name="firstDueDate"
        type="date"
        errors={e.firstDueDate}
      />

      <div className="rounded-2xl border border-border bg-surface p-4">
        <label className="flex min-h-12 items-center gap-3 text-lg font-semibold">
          <input type="checkbox" name="alreadyStarted" checked={started} onChange={(ev) => setStarted(ev.target.checked)} className="size-7 shrink-0 accent-[var(--primary)]" />
          Ya llevo pagos de esta compra
        </label>
        {started && (
          <div className="mt-3 flex flex-col gap-2">
            <TextField
              label="¿Cuántas mensualidades ya pagaste?"
              hint="Por ejemplo, si vas en el pago 8 de 12, ya pagaste 7. Esas no se cuentan en tus meses pasados."
              name="paidBefore"
              inputMode="numeric"
              errors={e.paidBefore}
            />
          </div>
        )}
      </div>

      <StickyAction>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar compra a meses"}
        </Button>
      </StickyAction>
    </form>
  );
}
