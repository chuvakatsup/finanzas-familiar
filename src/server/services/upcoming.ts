import { and, eq, gte, isNull, lte } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { accounts, loanPayments, loans } from "@/server/db/schema";
import type { Actor } from "@/server/authz";
import { APP_TIME_ZONE, type IsoDate, todayIso } from "@/domain/dates";
import { addDays } from "@/domain/recurrence";
import { listAccounts } from "./accounts";
import { getCardStatement } from "./cards";
import { type DueItem, LOOKBACK_DAYS, listUpcoming } from "./scheduled";

function dateInAppZone(at: Date): IsoDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE }).format(at);
}

/** Cuotas de préstamos en el rango (pendientes, o pagadas hoy para poder deshacer). */
async function loanItems(db: DbOrTx, actor: Actor, from: IsoDate, to: IsoDate, today: IsoDate): Promise<DueItem[]> {
  const rows = await db
    .select({ row: loanPayments, loan: loans, payFromName: accounts.name })
    .from(loanPayments)
    .innerJoin(loans, eq(loans.id, loanPayments.loanId))
    .leftJoin(accounts, eq(accounts.id, loans.payFromAccountId))
    .where(
      and(
        eq(loanPayments.userId, actor.id),
        eq(loanPayments.kind, "cuota"),
        isNull(loans.archivedAt),
        gte(loanPayments.dueDate, from),
        lte(loanPayments.dueDate, to),
      ),
    );
  return rows
    .filter(({ row }) => row.status === "pendiente" || (row.status === "pagado" && row.recordedAt && dateInAppZone(row.recordedAt) === today))
    .map(({ row, loan, payFromName }) => ({
      source: "prestamo" as const,
      itemId: loan.id,
      rowId: row.id,
      detail: `Pago ${row.number} de ${loan.nPayments}`,
      kind: "pago" as const,
      name: loan.name,
      dueDate: row.dueDate,
      amount: row.payment,
      amountIsEstimate: false,
      status: row.status === "pendiente" ? ("pendiente" as const) : ("confirmado" as const),
      actualAmount: row.status === "pagado" ? row.payment : null,
      transactionId: null,
      accountId: loan.payFromAccountId ?? "",
      accountName: payFromName ?? "—",
      categoryIcon: "📄",
      autoRegister: false,
      actedAt: row.recordedAt,
    }));
}

/** Recordatorio de pago de cada tarjeta (lo que falta para no generar intereses). */
async function cardItems(db: DbOrTx, actor: Actor, from: IsoDate, to: IsoDate, today: IsoDate): Promise<DueItem[]> {
  const cards = (await listAccounts(db, actor)).filter((a) => a.kind === "credito" && a.statementDay && a.paymentDueDay);
  const out: DueItem[] = [];
  for (const card of cards) {
    const st = await getCardStatement(db, actor, card.id, today);
    if (!st || st.noInterestPaymentLeft <= 0 || st.dueDate < from || st.dueDate > to) continue;
    out.push({
      source: "tarjeta",
      itemId: card.id,
      rowId: null,
      detail: "Para no generar intereses",
      kind: "pago",
      name: `Pagar tarjeta ${card.name}`,
      dueDate: st.dueDate,
      amount: st.noInterestPaymentLeft,
      amountIsEstimate: true,
      status: "pendiente",
      actualAmount: null,
      transactionId: null,
      accountId: card.id,
      accountName: card.name,
      categoryIcon: "💳",
      autoRegister: false,
      actedAt: null,
    });
  }
  return out;
}

/** Todo lo que toca pagar/recibir: programados + cuotas de préstamos + tarjetas. */
export async function listAllUpcoming(db: DbOrTx, actor: Actor, days: number, today = todayIso()) {
  const from = addDays(today, -LOOKBACK_DAYS);
  const to = addDays(today, days);
  const [scheduled, loanList, cardList] = await Promise.all([
    listUpcoming(db, actor, days, today),
    loanItems(db, actor, from, to, today),
    cardItems(db, actor, from, to, today),
  ]);
  const extra = [...loanList, ...cardList];
  const byDate = (a: DueItem, b: DueItem) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name);
  return {
    overdue: [...scheduled.overdue, ...extra.filter((d) => d.dueDate < today)].sort(byDate),
    upcoming: [...scheduled.upcoming, ...extra.filter((d) => d.dueDate >= today)].sort(byDate),
  };
}
