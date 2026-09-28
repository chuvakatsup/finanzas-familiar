import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/current";
import { logoutAction } from "@/server/actions/auth";
import { Button, Card, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Más" };

const links = [{ href: "/mas/familia", icon: "👨‍👩‍👧", label: "Mi familia", text: "Quiénes están en el grupo" }];

export default async function MorePage() {
  const user = await requireUser();
  return (
    <>
      <PageTitle subtitle={user.email}>{user.name}</PageTitle>
      <ul className="mb-6 flex flex-col gap-3">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="flex min-h-16 items-center gap-4 rounded-2xl border border-border bg-surface p-4 hover:bg-surface-2"
            >
              <span aria-hidden="true" className="text-3xl">
                {l.icon}
              </span>
              <span className="flex flex-col">
                <span className="text-xl font-semibold">{l.label}</span>
                <span className="text-base text-muted">{l.text}</span>
              </span>
              <span aria-hidden="true" className="ml-auto text-2xl text-muted">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Card>
        <form action={logoutAction}>
          <Button type="submit" variant="secondary">
            <span aria-hidden="true">🚪</span> Cerrar sesión
          </Button>
        </form>
      </Card>
    </>
  );
}
