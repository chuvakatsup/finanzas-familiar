"use client";

import { useActionState } from "react";
import { adjustBalanceAction } from "@/server/actions/finance";
import { initialFormState } from "@/lib/form-state";
import { Alert, Button, TextField } from "@/components/ui";

export function AdjustForm({ id, isDebt }: { id: string; isDebt: boolean }) {
  const [state, action, pending] = useActionState(adjustBalanceAction.bind(null, id), initialFormState);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.message && <Alert>{state.message}</Alert>}
      <TextField
        label={isDebt ? "¿Cuánto debes de verdad?" : "¿Cuánto tienes de verdad?"}
        name="realBalance"
        inputMode="decimal"
        placeholder="0.00"
        required
        errors={state.fieldErrors?.realBalance}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
