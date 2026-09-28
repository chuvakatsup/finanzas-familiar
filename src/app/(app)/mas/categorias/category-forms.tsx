"use client";

import { useActionState, useState } from "react";
import {
  createCategoryAction,
  setCategoryArchivedAction,
  updateCategoryAction,
} from "@/server/actions/finance";
import { CATEGORY_ICON_CHOICES, type CategoryKind } from "@/domain/categories";
import { initialFormState } from "@/lib/form-state";
import { Alert, Button, TextField } from "@/components/ui";

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-lg font-semibold">Dibujito</legend>
      <div className="grid grid-cols-6 gap-2" role="radiogroup">
        {CATEGORY_ICON_CHOICES.map((icon) => (
          <button
            key={icon}
            type="button"
            role="radio"
            aria-checked={value === icon}
            aria-label={icon}
            onClick={() => onChange(icon)}
            className={`flex aspect-square min-h-12 items-center justify-center rounded-xl border-2 text-2xl ${
              value === icon ? "border-primary bg-surface-2" : "border-border bg-surface"
            }`}
          >
            {icon}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function NewCategoryForm({ kind }: { kind: CategoryKind }) {
  const [icon, setIcon] = useState<string>(CATEGORY_ICON_CHOICES[0]);
  const [state, action, pending] = useActionState(createCategoryAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" key={state.data?.saved}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="icon" value={icon} />
      {state.message && <Alert>{state.message}</Alert>}
      {state.data?.saved && <Alert kind="ok">Se agregó “{state.data.saved}”.</Alert>}
      <TextField label="Nombre" name="name" maxLength={30} errors={state.fieldErrors?.name} />
      <IconPicker value={icon} onChange={setIcon} />
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Agregar"}
      </Button>
    </form>
  );
}

export function CategoryItem({
  category,
}: {
  category: { id: string; name: string; icon: string; archived: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [icon, setIcon] = useState(category.icon);
  const [state, action, pending] = useActionState(updateCategoryAction.bind(null, category.id), initialFormState);
  const [archState, archAction, archPending] = useActionState(
    setCategoryArchivedAction.bind(null, category.id, !category.archived),
    initialFormState,
  );

  return (
    <li className="rounded-2xl border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-16 w-full items-center gap-3 p-3 text-left"
      >
        <span aria-hidden="true" className="text-3xl">
          {category.icon}
        </span>
        <span className="flex-1 text-xl font-semibold">{category.name}</span>
        <span aria-hidden="true" className="text-xl text-muted">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t border-border p-4">
          <form action={action} className="flex flex-col gap-4">
            <input type="hidden" name="icon" value={icon} />
            {state.message && <Alert>{state.message}</Alert>}
            {state.data?.saved && <Alert kind="ok">Guardado.</Alert>}
            <TextField label="Nombre" name="name" defaultValue={category.name} maxLength={30} errors={state.fieldErrors?.name} />
            <IconPicker value={icon} onChange={setIcon} />
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </form>
          <form action={archAction}>
            {archState.message && <Alert>{archState.message}</Alert>}
            <Button type="submit" variant="secondary" disabled={archPending}>
              {category.archived ? "👁️ Volver a mostrar" : "🙈 Ocultar esta categoría"}
            </Button>
          </form>
          {!category.archived && (
            <p className="text-base text-muted">
              Ocultarla no borra tus movimientos; solo deja de aparecer al registrar.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
