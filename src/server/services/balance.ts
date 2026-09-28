import type { DbOrTx } from "@/server/db";
import type { Actor } from "@/server/authz";
import { type MonthBalance, computeMonthBalance, spendingByCategory } from "@/domain/balance";
import { type IsoDate, todayIso } from "@/domain/dates";
import type { Cents } from "@/domain/money";
import { type YearMonth, monthRange } from "@/domain/months";
import { getBudgets } from "./budget";
import { listCategories } from "./categories";
import { getPrefs, warnPct } from "./prefs";
import { type DueItem, listDue } from "./scheduled";
import { type TxRow, listTransactions } from "./transactions";

export type CategoryBreakdown = {
  categoryId: string | null;
  name: string;
  icon: string;
  total: Cents;
  share: number;
  limit: Cents | null;
};

export type MonthReport = {
  month: YearMonth;
  balance: MonthBalance;
  txs: TxRow[];
  due: DueItem[];
  byCategory: CategoryBreakdown[];
  /** Categorías con límite aunque aún no tengan gasto (para mostrarlas). */
  budgetsByCategory: Record<string, Cents>;
};

/** Todo lo necesario para el semáforo y el detalle de un mes. */
export async function getMonthReport(
  db: DbOrTx,
  actor: Actor,
  month: YearMonth,
  today: IsoDate = todayIso(),
): Promise<MonthReport> {
  const [from, to] = monthRange(month);
  const [txs, due, budgets, prefs, cats] = await Promise.all([
    listTransactions(db, actor, { from, to, limit: 5000 }),
    listDue(db, actor, from, to),
    getBudgets(db, actor),
    getPrefs(db, actor),
    listCategories(db, actor, "gasto", { includeArchived: true }),
  ]);

  const balance = computeMonthBalance({
    month,
    today,
    txs,
    due,
    budget: budgets.general,
    warnPct: warnPct(prefs),
  });

  const catById = new Map(cats.map((c) => [c.id, c]));
  const spent = spendingByCategory(txs);
  const byCategory: CategoryBreakdown[] = spent.map((s) => {
    const c = s.categoryId ? catById.get(s.categoryId) : undefined;
    return {
      ...s,
      name: c?.name ?? "Sin categoría",
      icon: c?.icon ?? "📦",
      limit: s.categoryId ? (budgets.byCategory[s.categoryId] ?? null) : null,
    };
  });
  // Categorías con límite y sin gasto todavía: también se muestran (en $0).
  for (const [categoryId, limit] of Object.entries(budgets.byCategory)) {
    if (byCategory.some((b) => b.categoryId === categoryId)) continue;
    const c = catById.get(categoryId);
    if (c) byCategory.push({ categoryId, name: c.name, icon: c.icon, total: 0, share: 0, limit });
  }

  return { month, balance, txs, due, byCategory, budgetsByCategory: budgets.byCategory };
}
