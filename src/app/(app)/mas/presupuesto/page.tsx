import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { getBudgets } from "@/server/services/budget";
import { listCategories } from "@/server/services/categories";
import { getPrefs, warnPct } from "@/server/services/prefs";
import { centsToInput } from "@/domain/money";
import { PageTitle } from "@/components/ui";
import { BudgetForm } from "./budget-form";

export const metadata: Metadata = { title: "Mi presupuesto" };

export default async function BudgetPage() {
  const actor = await requireUser();
  const db = getDb();
  const [budgets, cats, prefs] = await Promise.all([
    getBudgets(db, actor),
    listCategories(db, actor, "gasto"),
    getPrefs(db, actor),
  ]);
  return (
    <>
      <PageTitle subtitle="Opcional. Te ayuda a saber cuánto puedes gastar al día.">Mi presupuesto</PageTitle>
      <BudgetForm
        general={budgets.general != null ? centsToInput(budgets.general) : ""}
        warnPct={warnPct(prefs)}
        categories={cats.map((c) => ({
          id: c.id,
          name: c.name,
          icon: c.icon,
          limit: budgets.byCategory[c.id] != null ? centsToInput(budgets.byCategory[c.id]) : "",
        }))}
      />
    </>
  );
}
