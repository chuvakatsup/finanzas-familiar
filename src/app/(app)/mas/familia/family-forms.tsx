"use client";

import { useActionState, useState } from "react";
import { createInvitationAction, createResetLinkAction } from "@/server/actions/family";
import { initialFormState } from "@/lib/form-state";
import { Alert, Button, TextField } from "@/components/ui";

/** Muestra un enlace secreto con botones grandes para copiarlo o mandarlo por WhatsApp. */
function ShareLink({ link, message }: { link: string; message: string }) {
  const [copied, setCopied] = useState(false);
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${message}\n${link}`)}`;
  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-ok bg-ok-bg p-4">
      <p className="text-lg font-semibold text-ok">
        <span aria-hidden="true">✅ </span>Enlace listo. Mándalo solo a esa persona.
      </p>
      <p className="break-all rounded-lg bg-surface p-3 font-mono text-base">{link}</p>
      <Button
        type="button"
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopied(true);
        }}
      >
        {copied ? "✔️ Copiado" : "📋 Copiar enlace"}
      </Button>
      <a
        href={whatsapp}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-primary px-5 text-lg font-semibold text-on-primary"
      >
        💬 Enviar por WhatsApp
      </a>
    </div>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState(createInvitationAction, initialFormState);
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        {state.message && <Alert>{state.message}</Alert>}
        <TextField
          label="Nombre de la persona (opcional)"
          name="suggestedName"
          hint="Se usa para reconocer la invitación. El enlace sirve 7 días y una sola vez."
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Creando…" : "Crear enlace de invitación"}
        </Button>
      </form>
      {state.data?.link && (
        <ShareLink
          link={state.data.link}
          message={`Hola${state.data.name ? ` ${state.data.name}` : ""}, te invito a Mis Finanzas. Abre este enlace para crear tu cuenta:`}
        />
      )}
    </div>
  );
}

export function ResetLinkButton({ userId, name }: { userId: string; name: string }) {
  const [state, action, pending] = useActionState(createResetLinkAction, initialFormState);
  return (
    <div className="flex flex-col gap-3">
      <form action={action}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          disabled={pending}
          className="min-h-12 rounded-xl px-1 text-left text-base font-semibold text-primary underline underline-offset-4"
        >
          🔑 Crear enlace para contraseña nueva de {name}
        </button>
      </form>
      {state.message && <Alert>{state.message}</Alert>}
      {state.data?.link && (
        <ShareLink
          link={state.data.link}
          message={`Hola ${name}, abre este enlace para poner tu contraseña nueva de Mis Finanzas (sirve 24 horas):`}
        />
      )}
    </div>
  );
}
