import type { Metadata } from "next";
import { ScheduledNewPage } from "../../_programados/pages";

export const metadata: Metadata = { title: "Agregar" };

export default function Page() {
  return <ScheduledNewPage kind="pago" />;
}
