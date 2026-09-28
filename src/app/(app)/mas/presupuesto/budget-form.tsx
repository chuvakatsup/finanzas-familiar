"use client";

import { useActionState } from "react";
import { saveBudgetAction } from "@/server/actions/settings";
import { initialFormState } from "@/lib/form-state";
import { WARN_PCT_CHOICES } from "@/lib/schemas/finance";
import { Alert, Button, TextField } from "@/components/ui";
import { StickyAction } from "@/components/sticky-action";

export function BudgetForm({
  general,
  warnPct,
  categories,
}: {
  general: string;
  warnPct: number;
  categories: { id: string; name: string; icon: string; limit: string }[];
}) {
  const [state, action, pending] = useActionState(saveBudgetAction, initialFormState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.message && <Alert>{state.message}</Alert>}
      {state.data?.saved && <Alert kind="ok">Presupuesto guardado.</Alert>}

      <TextField
        label="¿Cuánto quieres gastar al mes en el día a día?"
        hint="Comida, súper, transporte, gustos… (sin contar tus pagos fijos). Déjalo vacío si no quieres presupuesto."
        name="general"
        inputMode="decimal"
        placeholder="Ej. 4000"
        defaultValue={general}
        errors={e.general}
      />

      <label className="flex flex-col gap-1 text-lg font-semibold">
        Ponerme en amarillo cuando me sobre menos de…
        <select
          name="warnPct"
          defaultValue={String(warnPct)}
          className="min-h-14 rounded-xl border-2 border-border bg-surface px-3 text-lg font-normal"
        >
          {WARN_PCT_CHOICES.map((p) => (
            <option key={p} value={p}>
              {p}% de lo que me entra
            </option>
          ))}
        </select>
      </label>

      <details className="rounded-2xl border border-border bg-surface p-4">
        <summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">
          Límites por categoría (opcional)
        </summary>
        <p className="mb-3 text-base text-muted">
          Te avisamos en “¿A dónde se va mi dinero?” si te pasas. Deja vacío lo que no quieras limitar.
        </p>
        <div className="flex flex-col gap-4">
          {categories.map((c) => (
            <TextField
              key={c.id}
              label={`${c.icon} ${c.name}`}
              name={`cat_${c.id}`}
              inputMode="decimal"
              placeholder="Sin límite"
              defaultValue={c.limit}
            />
          ))}
        </div>
      </details>

      <StickyAction>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar presupuesto"}
        </Button>
      </StickyAction>
    </form>
  );
}
