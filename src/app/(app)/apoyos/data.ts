import "server-only";
import type { Db } from "@/server/db";
import type { Actor } from "@/server/authz";
import { listAccounts } from "@/server/services/accounts";
import { debtsForApply, inboxSupports } from "@/server/services/support";
import type { ApplyOptions, InboxItem } from "@/components/support-inbox";

/** Lo que necesita la bandeja "¿Ya lo recibiste?" (datos de QUIEN RECIBE, nunca de quien envía). */
export async function inboxData(db: Db, actor: Actor): Promise<{ items: InboxItem[]; options: ApplyOptions }> {
  const [pending, accounts, debts] = await Promise.all([inboxSupports(db, actor), listAccounts(db, actor), debtsForApply(db, actor)]);
  return {
    items: pending.map((p) => ({
      id: p.id,
      senderName: p.senderName,
      amount: p.amount,
      date: p.date,
      purpose: p.purpose,
      note: p.note,
      received: p.status === "recibido",
    })),
    options: { accounts: accounts.map(({ id, name, kind }) => ({ id, name, kind })), cards: debts.cards, loans: debts.loans },
  };
}
