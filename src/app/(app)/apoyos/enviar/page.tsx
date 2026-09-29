import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { listAccounts } from "@/server/services/accounts";
import { listMembers } from "@/server/services/household";
import { todayIso } from "@/domain/dates";
import { Alert, ButtonLink, PageTitle } from "@/components/ui";
import { RegisterTabs } from "../../registrar/register-tabs";
import { SendSupportForm } from "./send-form";

export const metadata: Metadata = { title: "Enviar apoyo" };

export default async function SendSupportPage() {
  const actor = await requireUser();
  const db = getDb();
  const [members, accounts] = await Promise.all([listMembers(db, actor), listAccounts(db, actor)]);
  const others = members.filter((m) => !m.isMe);
  const money = accounts.filter((a) => a.kind !== "credito" && a.kind !== "prestamo");

  return (
    <>
      <RegisterTabs current="apoyo" />
      <PageTitle subtitle="Anótalo aquí después de mandarlo por el banco.">Enviar apoyo</PageTitle>
      {others.length === 0 ? (
        <>
          <Alert kind="warn">Todavía no hay nadie más en tu familia dentro de la app.</Alert>
          <div className="mt-4">
            <ButtonLink href="/mas/familia">Invitar a alguien</ButtonLink>
          </div>
        </>
      ) : (
        <SendSupportForm
          today={todayIso()}
          people={others.map((m) => ({ id: m.id, name: m.name }))}
          accounts={money.map((a) => ({ id: a.id, name: a.name, kind: a.kind }))}
        />
      )}
    </>
  );
}
