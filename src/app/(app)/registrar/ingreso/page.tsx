import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { listAccounts } from "@/server/services/accounts";
import { listCategories } from "@/server/services/categories";
import { lastUsedAccountId } from "@/server/services/transactions";
import { todayIso } from "@/domain/dates";
import { RegisterTabs } from "../register-tabs";
import { TxWizard } from "../tx-wizard";

export const metadata: Metadata = { title: "Registrar ingreso" };

export default async function RegisterIncomePage() {
  const actor = await requireUser();
  const db = getDb();
  const [accounts, categories, lastAccount] = await Promise.all([
    listAccounts(db, actor),
    listCategories(db, actor, "ingreso"),
    lastUsedAccountId(db, actor, "ingreso"),
  ]);
  // Un ingreso no entra a una tarjeta de crédito.
  const options = accounts.filter((a) => a.kind !== "credito" && a.kind !== "prestamo");
  const preferred = options.find((a) => a.id === lastAccount)?.id ?? options.find((a) => a.kind === "debito")?.id ?? null;
  return (
    <>
      <h1 className="sr-only">Registrar ingreso</h1>
      <RegisterTabs current="ingreso" />
      <TxWizard
        kind="ingreso"
        today={todayIso()}
        categories={categories.map(({ id, name, icon }) => ({ id, name, icon }))}
        accounts={options.map(({ id, name, kind, balance }) => ({ id, name, kind, balance }))}
        defaultAccountId={preferred}
      />
    </>
  );
}
