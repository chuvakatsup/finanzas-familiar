import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { listCategories } from "@/server/services/categories";
import type { CategoryKind } from "@/domain/categories";
import { Card, PageTitle } from "@/components/ui";
import { CategoryItem, NewCategoryForm } from "./category-forms";

export const metadata: Metadata = { title: "Categorías" };

export default async function CategoriesPage({ searchParams }: PageProps<"/mas/categorias">) {
  const actor = await requireUser();
  const { tipo } = await searchParams;
  const kind: CategoryKind = tipo === "ingreso" ? "ingreso" : "gasto";
  const all = await listCategories(getDb(), actor, kind, { includeArchived: true });
  const active = all.filter((c) => !c.archived);
  const hidden = all.filter((c) => c.archived);

  const tab = (k: CategoryKind, label: string) => (
    <Link
      href={`/mas/categorias?tipo=${k}`}
      aria-current={kind === k ? "page" : undefined}
      className={`flex min-h-14 items-center justify-center rounded-2xl border-2 text-lg font-semibold ${
        kind === k ? "border-primary bg-primary text-on-primary" : "border-border bg-surface"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageTitle subtitle="Toca una para cambiarle el nombre o el dibujito.">Categorías</PageTitle>
      <nav aria-label="Tipo de categoría" className="mb-5 grid grid-cols-2 gap-2">
        {tab("gasto", "De gastos")}
        {tab("ingreso", "De ingresos")}
      </nav>

      <ul className="mb-6 flex flex-col gap-2">
        {active.map((c) => (
          <CategoryItem key={c.id} category={c} />
        ))}
      </ul>

      <Card className="mb-6">
        <h2 className="mb-3 text-2xl font-bold">Agregar categoría</h2>
        <NewCategoryForm kind={kind} />
      </Card>

      {hidden.length > 0 && (
        <details className="rounded-2xl border border-border bg-surface p-4">
          <summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">Ocultas ({hidden.length})</summary>
          <ul className="mt-3 flex flex-col gap-2">
            {hidden.map((c) => (
              <CategoryItem key={c.id} category={c} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
