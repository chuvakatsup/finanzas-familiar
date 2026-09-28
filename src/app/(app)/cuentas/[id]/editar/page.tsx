import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { AuthzError } from "@/server/authz";
import { getAccount } from "@/server/services/accounts";
import { getAnnualFee } from "@/server/services/cards";
import { centsToInput } from "@/domain/money";
import { PageTitle } from "@/components/ui";
import { AccountForm } from "../../account-form";

export const metadata: Metadata = { title: "Editar cuenta" };

export default async function EditAccountPage({ params }: PageProps<"/cuentas/[id]/editar">) {
  const actor = await requireUser();
  const { id } = await params;
  const a = await getAccount(getDb(), actor, id).catch((e) => {
    if (e instanceof AuthzError) notFound();
    throw e;
  });
  const fee = a.kind === "credito" ? await getAnnualFee(getDb(), actor, a.id) : null;
  return (
    <>
      <PageTitle>Editar cuenta</PageTitle>
      <AccountForm
        existing={{
          id: a.id,
          kind: a.kind,
          name: a.name,
          last4: a.last4,
          creditLimit: a.creditLimit != null ? centsToInput(a.creditLimit) : "",
          statementDay: a.statementDay,
          paymentDueDay: a.paymentDueDay,
          interestRate: a.interestRateBp != null ? String(a.interestRateBp / 100) : "",
          annualFee: fee
            ? { amount: centsToInput(fee.amount), nextDate: fee.nextDate ?? "", withIva: fee.withIva }
            : null,
        }}
      />
    </>
  );
}
