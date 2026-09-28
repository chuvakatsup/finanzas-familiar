"use client";

import { useActionState } from "react";
import { loginAction } from "@/server/actions/auth";
import { initialFormState } from "@/lib/form-state";
import { Alert, Button, TextField } from "@/components/ui";
import { PasswordField } from "@/components/password-field";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.message && <Alert>{state.message}</Alert>}
      <TextField
        label="Correo"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        required
        errors={state.fieldErrors?.email}
      />
      <PasswordField
        label="Contraseña"
        name="password"
        autoComplete="current-password"
        errors={state.fieldErrors?.password}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
