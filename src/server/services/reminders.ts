import "server-only";
import { eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { pushSubscriptions, users } from "@/server/db/schema";
import type { Actor } from "@/server/authz";
import { type IsoDate, todayIso } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { addDays, relativeDay } from "@/domain/recurrence";
import { notifyOnce, pushConfigured } from "./push";
import { syncAutoOccurrences } from "./scheduled";
import { pendingToConfirm, syncSupportSchedules } from "./support";
import { listAllUpcoming } from "./upcoming";

export type ReminderSummary = { users: number; sent: number };

/**
 * Recordatorio diario (lo pide el servicio "cron" una vez al día, por la mañana):
 * - Pagos/cuotas que vencen hoy o mañana, pendientes vencidos, tarjeta que vence en ≤3 días.
 * - Apoyos que me enviaron y no he confirmado.
 * Un solo aviso por día por persona (más uno por cada apoyo); nunca se repite.
 */
export async function runDailyReminders(db: DbOrTx, today: IsoDate = todayIso()): Promise<ReminderSummary> {
  if (!pushConfigured()) return { users: 0, sent: 0 };
  const withSubs = await db.selectDistinct({ userId: pushSubscriptions.userId }).from(pushSubscriptions);
  if (!withSubs.length) return { users: 0, sent: 0 };
  const people = await db
    .select({ id: users.id, householdId: users.householdId, role: users.role, active: users.active })
    .from(users)
    .where(inArray(users.id, withSubs.map((s) => s.userId)));

  let sent = 0;
  for (const p of people.filter((u) => u.active)) {
    const actor: Actor = { id: p.id, householdId: p.householdId, role: p.role };
    // Primero se anotan los automáticos, para no recordar algo que ya se pagó solo.
    await syncAutoOccurrences(db, actor, today);
    await syncSupportSchedules(db, actor, today);

    const { overdue, upcoming } = await listAllUpcoming(db, actor, 3, today);
    const tomorrow = addDays(today, 1);
    const relevant = [
      ...overdue.filter((d) => d.status === "pendiente"),
      ...upcoming.filter((d) => d.status === "pendiente" && (d.dueDate <= tomorrow || d.source === "tarjeta")),
    ].filter((d) => d.kind === "pago" || d.dueDate <= today);

    if (relevant.length) {
      const lines = relevant
        .slice(0, 4)
        .map((d) => `${d.name}: ${formatMoney(d.amount)} (${relativeDay(d.dueDate, today).toLowerCase()})`);
      const more = relevant.length > 4 ? ` y ${relevant.length - 4} más` : "";
      const ok = await notifyOnce(db, p.id, `recordatorio:${today}`, {
        title: relevant.length === 1 ? "Tienes 1 pendiente" : `Tienes ${relevant.length} pendientes`,
        body: lines.join(" · ") + more,
        url: "/proximos",
        tag: "recordatorio-diario",
      });
      if (ok) sent++;
    }

    for (const s of await pendingToConfirm(db, actor, today)) {
      if (await notifyOnce(db, p.id, `apoyo:${s.id}`, supportPayload(s.senderName, s.amount))) sent++;
    }
  }
  return { users: people.length, sent };
}

export function supportPayload(senderName: string, amount: number) {
  return {
    title: "Te enviaron un apoyo 🤝",
    body: `${senderName} te envió ${formatMoney(amount)}. ¿Ya lo recibiste?`,
    url: "/",
    tag: "apoyo",
  };
}

/** Aviso inmediato al enviar un apoyo (si quien recibe tiene avisos activados). */
export async function notifySupportSent(db: DbOrTx, support: { id: string; recipientId: string; amount: number; senderId: string }) {
  const [sender] = await db.select({ name: users.name }).from(users).where(eq(users.id, support.senderId)).limit(1);
  await notifyOnce(db, support.recipientId, `apoyo:${support.id}`, supportPayload(sender?.name ?? "Tu familia", support.amount));
}

/** Aviso inmediato a quien le asignaron una parte de un gasto compartido. */
export async function notifySharedCreated(
  db: DbOrTx,
  debts: readonly { id: string; ownerId: string; debtorId: string; amount: number; concept: string }[],
) {
  if (!debts.length) return;
  const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, debts[0].ownerId)).limit(1);
  for (const d of debts) {
    await notifyOnce(db, d.debtorId, `compartido:${d.id}`, {
      title: "Compartieron un gasto contigo 👥",
      body: `${owner?.name ?? "Tu familia"} pagó ${d.concept}. Te tocan ${formatMoney(d.amount)}.`,
      url: "/",
      tag: "compartido",
    });
  }
}

/** Aviso inmediato al dueño cuando le dicen "Ya te pagué". */
export async function notifySharedPaid(db: DbOrTx, debt: { id: string; ownerId: string; debtorId: string; amount: number; concept: string }) {
  const [debtor] = await db.select({ name: users.name }).from(users).where(eq(users.id, debt.debtorId)).limit(1);
  await notifyOnce(db, debt.ownerId, `compartido-pagado:${debt.id}`, {
    title: "Te pagaron una parte 👥",
    body: `${debtor?.name ?? "Tu familia"} dice que ya te pagó ${formatMoney(debt.amount)} de ${debt.concept}. ¿Te llegó?`,
    url: "/",
    tag: "compartido",
  });
}
