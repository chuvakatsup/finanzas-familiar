import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { AuthzError } from "@/server/authz";
import { getAccount } from "@/server/services/accounts";
import { ACCOUNT_KIND_INFO } from "@/domain/accounts";
import { formatMoney } from "@/domain/money";
import { PageTitle } from "@/components/ui";
import { AdjustForm } from "./adjust-form";

export const metadata: Metadata = { title: "Corregir saldo" };

export default async function AdjustPage({ params }: PageProps<"/cuentas/[id]/saldo">) {
  const actor = await requireUser();
  const { id } = await params;
  const a = await getAccount(getDb(), actor, id).catch((e) => {
    if (e instanceof AuthzError) notFound();
    throw e;
  });
  const isDebt = ACCOUNT_KIND_INFO[a.kind].isDebt;
  const shown = isDebt ? Math.max(0, -a.balance) : a.balance;
  return (
    <>
      <PageTitle subtitle={a.name}>{isDebt ? "Corregir lo que debo" : "Corregir saldo"}</PageTitle>
      <p className="mb-4 text-lg">
        La app dice que {isDebt ? "debes" : "tienes"}{" "}
        <strong className="tabular">{formatMoney(shown)}</strong>. Si en tu {isDebt ? "estado de cuenta" : "cartera o banco"}{" "}
        dice otra cosa, escribe la cantidad real. Guardaremos la diferencia como una corrección (no cuenta como
        gasto ni ingreso).
      </p>
      <AdjustForm id={a.id} isDebt={isDebt} />
    </>
  );
}
