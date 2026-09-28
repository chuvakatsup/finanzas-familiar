import type { Metadata } from "next";
import { requireUser } from "@/server/auth/current";
import { capitalize, formatLongDate, todayIso } from "@/domain/dates";
import { Card, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Inicio" };

export default async function HomePage() {
  const user = await requireUser();
  const today = capitalize(formatLongDate(todayIso()));
  return (
    <>
      <PageTitle subtitle={today}>Hola, {user.name}</PageTitle>
      <Card>
        <p className="text-xl font-semibold">
          <span aria-hidden="true">🚧 </span>Aquí verás si te alcanza el dinero este mes.
        </p>
        <p className="mt-2 text-lg text-muted">
          Estamos preparando esta pantalla. Pronto podrás registrar tus gastos e ingresos.
        </p>
      </Card>
    </>
  );
}
