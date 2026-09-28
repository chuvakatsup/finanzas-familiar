import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { getInvitation } from "@/server/services/invitations";
import { Alert, ButtonLink, Card } from "@/components/ui";
import { AcceptInvitationForm } from "./accept-form";

export const metadata: Metadata = { title: "Invitación", robots: { index: false } };

export default async function InvitationPage({ params }: PageProps<"/invitacion/[token]">) {
  const { token } = await params;
  const invitation = await getInvitation(getDb(), token);

  if (!invitation) {
    return (
      <Card>
        <h1 className="mb-4 text-3xl font-bold">Invitación no válida</h1>
        <Alert kind="warn">
          Este enlace ya venció o ya se usó. Pide a quien te invitó que te mande uno nuevo.
        </Alert>
        <div className="mt-5">
          <ButtonLink href="/login" variant="secondary">
            Ya tengo cuenta, entrar
          </ButtonLink>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-2 text-3xl font-bold">¡Bienvenido!</h1>
      <p className="mb-5 text-lg">
        Te invitaron a <strong>{invitation.householdName}</strong>. Crea tu cuenta; tus datos son solo
        tuyos.
      </p>
      <AcceptInvitationForm token={token} suggestedName={invitation.suggestedName ?? ""} />
    </Card>
  );
}
