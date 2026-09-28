import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Mis cuentas" };

export default function AccountsPage() {
  return (
    <ComingSoon title="Mis cuentas" text="Aquí verás tu efectivo, tarjetas y préstamos con sus saldos." />
  );
}
