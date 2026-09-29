import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { AuthzError } from "@/server/authz";
import { listMembers } from "@/server/services/household";
import { sharedForTx } from "@/server/services/shared";
import { getTransaction } from "@/server/services/transactions";
import { capitalize } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { Alert, ButtonLink, PageTitle } from "@/components/ui";
import { ShareForm } from "./share-form";

export const metadata: Metadata = { title: "Compartir gasto" };

export default async function ShareTxPage({ params }: PageProps<"/movimientos/[id]/compartir">) {
  const actor = await requireUser();
  const { id } = await params;
  const db = getDb();
  const tx = await getTransaction(db, actor, id).catch((e) => {
    if (e instanceof AuthzError) notFound();
    throw e;
  });
  if (tx.kind !== "gasto" || tx.origin !== "manual" || tx.deletedAt) notFound();
  const [members, parts] = await Promise.all([listMembers(db, actor), sharedForTx(db, actor, tx.id)]);
  const others = members.filter((m) => !m.isMe).map(({ id, name }) => ({ id, name }));

  return (
    <>
      <PageTitle subtitle={`${tx.note ?? tx.categoryName ?? "Gasto"} · ${capitalize(formatDay(tx.date))}`}>
        Compartir {formatMoney(tx.amount)}
      </PageTitle>
      {parts.length > 0 ? (
        <Alert kind="warn">Este gasto ya está compartido.</Alert>
      ) : others.length === 0 ? (
        <Alert kind="warn">Todavía no hay más personas en tu familia. Invítalas desde Más → Mi familia.</Alert>
      ) : (
        <ShareForm txId={tx.id} total={tx.amount} members={others} />
      )}
      <div className="mt-4">
        <ButtonLink href={`/movimientos/${tx.id}`} variant="secondary">
          Regresar
        </ButtonLink>
      </div>
    </>
  );
}
