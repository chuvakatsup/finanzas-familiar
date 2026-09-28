import type { Metadata } from "next";
import { ScheduledListPage } from "../_programados/pages";

export const metadata: Metadata = { title: "Pagos fijos" };

export default async function Page({ searchParams }: PageProps<"/pagos-fijos">) {
  return <ScheduledListPage kind="pago" searchParams={await searchParams} />;
}
