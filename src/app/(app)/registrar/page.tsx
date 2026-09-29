import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { listAccounts } from "@/server/services/accounts";
import { listCategories } from "@/server/services/categories";
import { lastUsedAccountId } from "@/server/services/transactions";
import { listMembers } from "@/server/services/household";
import { todayIso } from "@/domain/dates";
import { RegisterTabs } from "./register-tabs";
import { TxWizard } from "./tx-wizard";

export const metadata: Metadata = { title: "Registrar gasto" };

export default async function RegisterExpensePage() {
  const actor = await requireUser();
  const db = getDb();
  const [accounts, categories, lastAccount, members] = await Promise.all([
    listAccounts(db, actor),
    listCategories(db, actor, "gasto"),
    lastUsedAccountId(db, actor, "gasto"),
    listMembers(db, actor),
  ]);
  return (
    <>
      <h1 className="sr-only">Registrar gasto</h1>
      <RegisterTabs current="gasto" />
      <TxWizard
        kind="gasto"
        today={todayIso()}
        categories={categories.map(({ id, name, icon }) => ({ id, name, icon }))}
        accounts={accounts.map(({ id, name, kind, balance }) => ({ id, name, kind, balance }))}
        defaultAccountId={lastAccount}
        members={members.filter((m) => !m.isMe).map(({ id, name }) => ({ id, name }))}
      />
    </>
  );
}
