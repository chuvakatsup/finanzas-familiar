import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { listAccounts } from "@/server/services/accounts";
import { todayIso } from "@/domain/dates";
import { RegisterTabs } from "../register-tabs";
import { TransferForm } from "./transfer-form";

export const metadata: Metadata = { title: "Pasar dinero o pagar tarjeta" };

export default async function TransferPage({ searchParams }: PageProps<"/registrar/transferencia">) {
  const actor = await requireUser();
  const accounts = await listAccounts(getDb(), actor);
  const { a } = await searchParams;
  const defaultToId = typeof a === "string" && accounts.some((x) => x.id === a) ? a : null;
  return (
    <>
      <h1 className="sr-only">Pasar dinero o pagar tarjeta</h1>
      <RegisterTabs current="transferencia" />
      <TransferForm
        today={todayIso()}
        defaultToId={defaultToId}
        accounts={accounts.map(({ id, name, kind, balance }) => ({ id, name, kind, balance }))}
      />
    </>
  );
}
