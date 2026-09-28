import type { Metadata } from "next";
import { ScheduledListPage } from "../_programados/pages";

export const metadata: Metadata = { title: "Ingresos fijos" };

export default async function Page({ searchParams }: PageProps<"/ingresos-fijos">) {
  return <ScheduledListPage kind="ingreso" searchParams={await searchParams} />;
}
