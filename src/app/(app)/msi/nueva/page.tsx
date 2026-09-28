import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { listAccounts } from "@/server/services/accounts";
import { listCategories } from "@/server/services/categories";
import { todayIso } from "@/domain/dates";
import { Alert, ButtonLink, PageTitle } from "@/components/ui";
import { MsiForm } from "./msi-form";

export const metadata: Metadata = { title: "Compra a meses" };

export default async function NewMsiPage({ searchParams }: PageProps<"/msi/nueva">) {
  const actor = await requireUser();
  const { tarjeta, monto } = await searchParams;
  const db = getDb();
  const [accounts, cats] = await Promise.all([listAccounts(db, actor), listCategories(db, actor, "gasto")]);
  const cards = accounts.filter((a) => a.kind === "credito");
  if (cards.length === 0) {
    return (
      <>
        <PageTitle>Compra a meses</PageTitle>
        <Alert kind="warn">Primero agrega tu tarjeta de crédito.</Alert>
        <div className="mt-4">
          <ButtonLink href="/cuentas/nueva">Agregar tarjeta</ButtonLink>
        </div>
      </>
    );
  }
  return (
    <>
      <PageTitle subtitle="La tarjeta refleja el total, pero en tu mes solo cuenta la mensualidad.">
        Compra a meses
      </PageTitle>
      <MsiForm
        today={todayIso()}
        cards={cards.map((c) => ({ id: c.id, name: c.name }))}
        defaultCardId={typeof tarjeta === "string" && cards.some((c) => c.id === tarjeta) ? tarjeta : cards[0].id}
        defaultAmount={typeof monto === "string" && /^\d+(\.\d{1,2})?$/.test(monto) ? monto : ""}
        categories={cats.map(({ id, name, icon }) => ({ id, name, icon }))}
      />
    </>
  );
}
