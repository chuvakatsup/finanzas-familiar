import type { Metadata } from "next";
import { ScheduledEditPage } from "../../_programados/pages";

export const metadata: Metadata = { title: "Editar" };

export default async function Page({ params }: PageProps<"/pagos-fijos/[id]">) {
  const { id } = await params;
  return <ScheduledEditPage kind="pago" id={id} />;
}
