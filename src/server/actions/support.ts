"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import {
  createSupportSchedule,
  receiveSupport,
  sendSupport,
  setSupportCancelled,
  snoozeSupport,
  stopSupportSchedule,
  undoReceiveSupport,
  updateSupport,
} from "@/server/services/support";
import { updatePrefs } from "@/server/services/prefs";
import { notifySupportSent } from "@/server/services/reminders";
import { editSupportSchema, receiveSupportSchema, sendSupportSchema } from "@/lib/schemas/finance";
import { type FormState, fieldErrors } from "@/lib/form-state";
import { todayIso } from "@/domain/dates";
import { field, friendlyError } from "./helpers";

const refresh = () => revalidatePath("/", "layout");
const idOf = (v: string) => z.uuid().parse(v);

export async function sendSupportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = sendSupportSchema.safeParse({
    recipientId: field(formData, "recipientId"),
    amount: field(formData, "amount"),
    date: field(formData, "date"),
    fromAccountId: field(formData, "fromAccountId"),
    purpose: field(formData, "purpose"),
    note: field(formData, "note"),
    repeat: field(formData, "repeat") || "no",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { repeat, ...input } = parsed.data;
  let sent: Awaited<ReturnType<typeof sendSupport>> | null;
  try {
    sent = await getDb().transaction(async (t) => {
      const scheduleId =
        repeat === "no" ? null : (await createSupportSchedule(t, actor, { ...input, frequency: repeat })).id;
      // Recurrente con fecha futura: solo se programa; el primero se genera solo en su fecha.
      if (scheduleId && input.date > todayIso()) return null;
      return sendSupport(t, actor, input, scheduleId);
    });
  } catch (e) {
    return friendlyError(e);
  }
  const id = sent?.id ?? "";
  if (sent) {
    // Aviso inmediato en el celular de quien recibe (si lo tiene activado). Nunca rompe el envío.
    await notifySupportSent(getDb(), sent).catch((e) => console.error("push apoyo", e));
  }
  refresh();
  redirect(id ? `/apoyos/${id}?enviado=1` : "/apoyos?programado=1");
}

export async function editSupportAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = editSupportSchema.safeParse({
    amount: field(formData, "amount"),
    date: field(formData, "date"),
    fromAccountId: field(formData, "fromAccountId"),
    note: field(formData, "note"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    await getDb().transaction((t) => updateSupport(t, actor, idOf(id), parsed.data));
    refresh();
    return { data: { saved: "1" } };
  } catch (e) {
    return friendlyError(e);
  }
}

export async function cancelSupportAction(id: string, cancelled: boolean): Promise<FormState> {
  const actor = await requireUser();
  try {
    await getDb().transaction((t) => setSupportCancelled(t, actor, idOf(id), cancelled));
    refresh();
    return { data: { done: cancelled ? "cancelado" : "restaurado" } };
  } catch (e) {
    return friendlyError(e);
  }
}

/** "Sí, ya lo recibí". */
export async function receiveSupportAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = receiveSupportSchema.safeParse({
    accountId: field(formData, "accountId"),
    apply: field(formData, "apply"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    await getDb().transaction((t) => receiveSupport(t, actor, idOf(id), parsed.data));
    refresh();
    return { data: { done: "recibido" } };
  } catch (e) {
    return friendlyError(e);
  }
}

/** "Todavía no". */
export async function snoozeSupportAction(id: string): Promise<FormState> {
  const actor = await requireUser();
  try {
    await snoozeSupport(getDb(), actor, idOf(id));
    refresh();
    return { data: { done: "pospuesto" } };
  } catch (e) {
    return friendlyError(e);
  }
}

export async function undoReceiveSupportAction(id: string): Promise<FormState> {
  const actor = await requireUser();
  try {
    await getDb().transaction((t) => undoReceiveSupport(t, actor, idOf(id)));
    refresh();
    return { data: { done: "deshecho" } };
  } catch (e) {
    return friendlyError(e);
  }
}

export async function stopSupportScheduleAction(formData: FormData) {
  const actor = await requireUser();
  await getDb().transaction((t) => stopSupportSchedule(t, actor, idOf(field(formData, "id"))));
  refresh();
  redirect("/apoyos?detenido=1");
}

export async function setSupportPendingPrefAction(formData: FormData) {
  const actor = await requireUser();
  await updatePrefs(getDb(), actor, { apoyosPendientesCuentan: formData.get("value") === "1" });
  refresh();
}
