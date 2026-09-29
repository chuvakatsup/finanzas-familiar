"use client";

import { useActionState, useState, useTransition } from "react";
import { cancelSupportAction, editSupportAction, undoReceiveSupportAction } from "@/server/actions/support";
import { initialFormState } from "@/lib/form-state";
import { Alert, Button, TextField } from "@/components/ui";

const selectCls = "min-h-14 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg font-normal";

export function EditSupportForm({
  id,
  amount,
  date,
  note,
  fromAccountId,
  accounts,
}: {
  id: string;
  amount: string;
  date: string;
  note: string;
  fromAccountId: string;
  accounts: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(editSupportAction.bind(null, id), initialFormState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="mt-3 flex flex-col gap-4" noValidate>
      {state.message && <Alert>{state.message}</Alert>}
      {state.data?.saved && <Alert kind="ok">Cambios guardados.</Alert>}
      <TextField label="Monto" name="amount" inputMode="decimal" defaultValue={amount} errors={e.amount} />
      <TextField label="Fecha" name="date" type="date" defaultValue={date} errors={e.date} />
      <label className="flex flex-col gap-1 text-lg font-semibold">
        ¿De qué cuenta sale?
        <select name="fromAccountId" defaultValue={fromAccountId} className={selectCls}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <TextField label="Nota" name="note" defaultValue={note} maxLength={120} errors={e.note} />
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar cambios"}
      </Button>
    </form>
  );
}

/** Cancelar (con confirmación) o deshacer la cancelación. */
export function CancelSupport({ id, cancelled }: { id: string; cancelled: boolean }) {
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const run = (value: boolean) =>
    start(async () => {
      const r = await cancelSupportAction(id, value);
      setMsg(r.message ?? null);
      setAsking(false);
    });
  if (cancelled) {
    return (
      <div className="flex flex-col gap-2">
        {msg && <Alert>{msg}</Alert>}
        <Button type="button" variant="secondary" disabled={busy} onClick={() => run(false)}>
          ↩️ Deshacer la cancelación
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {msg && <Alert>{msg}</Alert>}
      {asking ? (
        <div className="flex flex-col gap-2 rounded-2xl border-2 border-danger bg-danger-bg p-4">
          <p className="text-lg font-semibold text-danger">¿Cancelar este apoyo? Se quita de tus movimientos.</p>
          <Button type="button" variant="danger" disabled={busy} onClick={() => run(true)}>
            Sí, cancelar
          </Button>
          <Button type="button" variant="secondary" onClick={() => setAsking(false)}>
            No, regresar
          </Button>
        </div>
      ) : (
        <Button type="button" variant="danger" onClick={() => setAsking(true)}>
          ✖️ Cancelar apoyo
        </Button>
      )}
    </div>
  );
}

export function UndoReceive({ id }: { id: string }) {
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      {msg && <Alert>{msg}</Alert>}
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await undoReceiveSupportAction(id);
            setMsg(r.message ?? null);
          })
        }
      >
        ↩️ Deshacer (todavía no lo recibo)
      </Button>
    </div>
  );
}
