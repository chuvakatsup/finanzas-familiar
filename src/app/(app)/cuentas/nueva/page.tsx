import type { Metadata } from "next";
import { PageTitle } from "@/components/ui";
import { AccountForm } from "../account-form";

export const metadata: Metadata = { title: "Agregar cuenta" };

export default function NewAccountPage() {
  return (
    <>
      <PageTitle>Agregar cuenta</PageTitle>
      <AccountForm />
    </>
  );
}
