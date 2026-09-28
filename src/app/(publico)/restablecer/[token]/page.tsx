import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { getPasswordReset } from "@/server/services/password-reset";
import { Alert, ButtonLink, Card } from "@/components/ui";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Contraseña nueva", robots: { index: false } };

export default async function ResetPage({ params }: PageProps<"/restablecer/[token]">) {
  const { token } = await params;
  const reset = await getPasswordReset(getDb(), token);

  if (!reset) {
    return (
      <Card>
        <h1 className="mb-4 text-3xl font-bold">Enlace no válido</h1>
        <Alert kind="warn">
          Este enlace ya venció o ya se usó. Pide a quien administra la familia uno nuevo.
        </Alert>
        <div className="mt-5">
          <ButtonLink href="/login" variant="secondary">
            Ir a entrar
          </ButtonLink>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-2 text-3xl font-bold">
        {reset.firstTime ? "Crea tu contraseña" : "Contraseña nueva"}
      </h1>
      <p className="mb-5 text-lg">
        Hola, <strong>{reset.name}</strong> ({reset.email}).
      </p>
      <ResetForm token={token} />
    </Card>
  );
}
