"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "@/server/actions/auth";
import { initialFormState } from "@/lib/form-state";
import { PASSWORD_MIN } from "@/lib/schemas/auth";
import { Alert, Button } from "@/components/ui";
import { PasswordField } from "@/components/password-field";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction.bind(null, token), initialFormState);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.message && <Alert>{state.message}</Alert>}
      <PasswordField
        label="Contraseña nueva"
        name="password"
        autoComplete="new-password"
        hint={`Al menos ${PASSWORD_MIN} letras o números. Puede ser una frase fácil de recordar.`}
        errors={state.fieldErrors?.password}
      />
      <PasswordField
        label="Escríbela otra vez"
        name="confirm"
        autoComplete="new-password"
        errors={state.fieldErrors?.confirm}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar y entrar"}
      </Button>
    </form>
  );
}
