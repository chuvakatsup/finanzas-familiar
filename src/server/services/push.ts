import "server-only";
import { and, eq, sql } from "drizzle-orm";
import webpush from "web-push";
import type { DbOrTx } from "@/server/db";
import { notificationLog, pushSubscriptions } from "@/server/db/schema";
import { serverEnv } from "@/server/env";
import type { Actor } from "@/server/authz";

export type PushPayload = {
  title: string;
  body: string;
  /** Pantalla a abrir al tocar el aviso. */
  url: string;
  /** Avisos con la misma etiqueta se reemplazan (no se apilan). */
  tag?: string;
};

export type SubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

let configured: boolean | null = null;

type Transport = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;
let transport: Transport = (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 60 * 60 * 12, urgency: "normal" });

/** Solo para pruebas: reemplaza el envío real (no hay servicio push en el entorno de pruebas). */
export function setPushTransportForTests(t: Transport) {
  transport = t;
}

/** ¿Hay llaves VAPID? Sin ellas la app funciona igual, solo sin recordatorios. */
export function pushConfigured(): boolean {
  if (configured == null) {
    const env = serverEnv();
    configured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
    if (configured) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  }
  return configured;
}

export function vapidPublicKey(): string | null {
  return pushConfigured() ? serverEnv().VAPID_PUBLIC_KEY! : null;
}

export async function saveSubscription(db: DbOrTx, actor: Actor, sub: SubscriptionInput, userAgent: string | null) {
  // Si ese celular estaba ligado a otra persona (cambió de cuenta), ahora es de quien lo activó.
  await db
    .insert(pushSubscriptions)
    .values({ userId: actor.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: actor.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth, failures: 0, userAgent },
    });
}

export async function removeSubscription(db: DbOrTx, actor: Actor, endpoint: string) {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, actor.id), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function countSubscriptions(db: DbOrTx, actor: Actor) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, actor.id));
  return row?.n ?? 0;
}

/** Envía a todos los celulares de la persona. Limpia suscripciones vencidas. Devuelve cuántos llegaron. */
export async function sendToUser(db: DbOrTx, userId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured()) return 0;
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  let delivered = 0;
  for (const s of subs) {
    try {
      await transport({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
      delivered++;
      await db.update(pushSubscriptions).set({ failures: 0, lastSuccessAt: new Date() }).where(eq(pushSubscriptions.id, s.id));
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410 || s.failures >= 5) {
        // El celular ya no acepta avisos (desinstaló la app o quitó el permiso).
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
      } else {
        await db
          .update(pushSubscriptions)
          .set({ failures: s.failures + 1 })
          .where(eq(pushSubscriptions.id, s.id));
      }
    }
  }
  return delivered;
}

/** Envía solo si ese aviso (`key`) no se ha mandado antes a esa persona. */
export async function notifyOnce(db: DbOrTx, userId: string, key: string, payload: PushPayload) {
  if (!pushConfigured()) return false;
  const inserted = await db
    .insert(notificationLog)
    .values({ userId, key })
    .onConflictDoNothing()
    .returning({ id: notificationLog.id });
  if (!inserted.length) return false;
  await sendToUser(db, userId, payload);
  return true;
}
