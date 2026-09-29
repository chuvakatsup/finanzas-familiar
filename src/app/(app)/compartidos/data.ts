import "server-only";
import type { Db } from "@/server/db";
import type { Actor } from "@/server/authz";
import { listAccounts } from "@/server/services/accounts";
import type { SharedView } from "@/server/services/shared";
import type { SharedAccounts, SharedItem } from "@/components/shared-inbox";

/** Cuentas de QUIEN VE la pantalla para pagar o recibir (nunca las de la otra persona). */
export async function sharedAccounts(db: Db, actor: Actor): Promise<SharedAccounts> {
  const accounts = await listAccounts(db, actor);
  return {
    payFrom: accounts.filter((a) => a.kind !== "credito" && a.kind !== "prestamo").map(({ id, name }) => ({ id, name })),
    receiveInto: accounts.filter((a) => a.kind !== "prestamo").map(({ id, name, kind }) => ({ id, name, kind })),
  };
}

export function toItem(v: SharedView): SharedItem {
  return {
    id: v.id,
    sourceTxId: v.sourceTxId,
    amount: v.amount,
    percentBp: v.percentBp,
    date: v.date,
    concept: v.concept,
    status: v.status,
    iAmOwner: v.iAmOwner,
    ownerName: v.ownerName,
    debtorName: v.debtorName,
  };
}
