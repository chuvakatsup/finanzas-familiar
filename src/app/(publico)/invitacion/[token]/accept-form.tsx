"use client";

import { useActionState } from "react";
import { acceptInvitationAction } from "@/server/actions/auth";
import { initialFormState } from "@/lib/form-state";
import { PASSWORD_MIN } from "@/lib/schemas/auth";
import { Alert, Button, TextField } from "@/components/ui";
import { PasswordField } from "@/components/password-field";

export function AcceptInvitationForm({ token, suggestedName }: { token: string; suggestedName: string }) {
  const [state, action, pending] = useActionState(
    acceptInvitationAction.bind(null, token),
    initialFormState,
  );
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.message && <Alert>{state.message}</Alert>}
      <TextField
        label="Tu nombre"
        name="name"
        autoComplete="given-name"
        defaultValue={suggestedName}
        required
        errors={state.fieldErrors?.name}
      />
      <TextField
        label="Tu correo"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        required
        errors={state.fieldErrors?.email}
      />
      <PasswordField
        label="Crea una contraseña"
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
        {pending ? "Creando tu cuenta…" : "Crear mi cuenta"}
      </Button>
    </form>
  );
}
