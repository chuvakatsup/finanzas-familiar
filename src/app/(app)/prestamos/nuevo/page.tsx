import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { listAccounts } from "@/server/services/accounts";
import { todayIso } from "@/domain/dates";
import { PageTitle } from "@/components/ui";
import { LoanForm } from "./loan-form";

export const metadata: Metadata = { title: "Agregar préstamo" };

export default async function NewLoanPage() {
  const actor = await requireUser();
  const accounts = (await listAccounts(getDb(), actor)).filter((a) => a.kind !== "prestamo" && a.kind !== "credito");
  return (
    <>
      <PageTitle subtitle="Calculamos la tabla de pagos por ti.">Agregar préstamo</PageTitle>
      <LoanForm today={todayIso()} accounts={accounts.map(({ id, name, kind }) => ({ id, name, kind }))} />
    </>
  );
}
