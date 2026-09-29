"use server";

import { z } from "zod";
import { getDb } from "@/server/db";
import { requireUser, userAgent } from "@/server/auth/current";
import { pushConfigured, removeSubscription, saveSubscription, sendToUser } from "@/server/services/push";
import type { FormState } from "@/lib/form-state";

const subscriptionSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export async function savePushSubscriptionAction(raw: unknown): Promise<FormState> {
  const actor = await requireUser();
  if (!pushConfigured()) return { message: "Los recordatorios aún no están configurados en el servidor." };
  const parsed = subscriptionSchema.safeParse(raw);
  if (!parsed.success) return { message: "No pudimos activar los recordatorios en este celular." };
  await saveSubscription(getDb(), actor, parsed.data, await userAgent());
  return { data: { done: "activado" } };
}

export async function removePushSubscriptionAction(endpoint: string): Promise<FormState> {
  const actor = await requireUser();
  await removeSubscription(getDb(), actor, z.string().max(1000).parse(endpoint));
  return { data: { done: "desactivado" } };
}

export async function sendTestPushAction(): Promise<FormState> {
  const actor = await requireUser();
  const n = await sendToUser(getDb(), actor.id, {
    title: "¡Listo! 🔔",
    body: "Así te llegarán los recordatorios de tus pagos.",
    url: "/",
    tag: "prueba",
  });
  return n > 0 ? { data: { done: "enviado" } } : { message: "No llegó el aviso. Revisa que el celular tenga permitido recibir notificaciones." };
}
