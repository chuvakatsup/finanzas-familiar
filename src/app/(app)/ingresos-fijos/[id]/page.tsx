import type { Metadata } from "next";
import { ScheduledEditPage } from "../../_programados/pages";

export const metadata: Metadata = { title: "Editar" };

export default async function Page({ params }: PageProps<"/ingresos-fijos/[id]">) {
  const { id } = await params;
  return <ScheduledEditPage kind="ingreso" id={id} />;
}
