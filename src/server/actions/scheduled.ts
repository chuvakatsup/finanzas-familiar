"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import {
  confirmOccurrence,
  createScheduled,
  setScheduledArchived,
  skipOccurrence,
  undoOccurrence,
  updateScheduled,
} from "@/server/services/scheduled";
import { confirmOccurrenceSchema, isoDateSchema, scheduledFormSchema } from "@/lib/schemas/finance";
import { type FormState, fieldErrors } from "@/lib/form-state";
import { field, friendlyError } from "./helpers";

const listPath = (kind: string) => (kind === "ingreso" ? "/ingresos-fijos" : "/pagos-fijos");

function parseScheduled(formData: FormData) {
  return scheduledFormSchema.safeParse({
    kind: field(formData, "kind"),
    name: field(formData, "name"),
    amount: field(formData, "amount"),
    amountIsEstimate: formData.get("amountIsEstimate") === "on",
    frequency: field(formData, "frequency"),
    nextDate: field(formData, "nextDate"),
    day1: field(formData, "day1"),
    day2: field(formData, "day2"),
    accountId: field(formData, "accountId"),
    categoryId: field(formData, "categoryId"),
    autoRegister: formData.get("autoRegister") === "on",
  });
}

export async function createScheduledAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = parseScheduled(formData);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    await getDb().transaction((t) => createScheduled(t, actor, parsed.data));
  } catch (e) {
    return friendlyError(e);
  }
  revalidatePath("/", "layout");
  redirect(`${listPath(parsed.data.kind)}?guardado=1`);
}

export async function updateScheduledAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = parseScheduled(formData);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    await getDb().transaction((t) => updateScheduled(t, actor, z.uuid().parse(id), parsed.data));
  } catch (e) {
    return friendlyError(e);
  }
  revalidatePath("/", "layout");
  redirect(`${listPath(parsed.data.kind)}?guardado=1`);
}

export async function setScheduledArchivedAction(formData: FormData) {
  const actor = await requireUser();
  const id = z.uuid().parse(field(formData, "id"));
  const archived = field(formData, "archived") === "1";
  await getDb().transaction((t) => setScheduledArchived(t, actor, id, archived));
  revalidatePath("/", "layout");
  redirect(`${listPath(field(formData, "kind"))}${archived ? "?quitado=1" : ""}`);
}

/** "Ya lo pagué" / "Ya me pagaron". */
export async function confirmOccurrenceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = confirmOccurrenceSchema.safeParse({
    itemId: field(formData, "itemId"),
    dueDate: field(formData, "dueDate"),
    amount: field(formData, "amount"),
    accountId: field(formData, "accountId"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { itemId, dueDate, amount, accountId } = parsed.data;
  try {
    const tx = await getDb().transaction((t) =>
      confirmOccurrence(t, actor, itemId, dueDate, { amount, accountId }),
    );
    revalidatePath("/", "layout");
    return { data: { done: "confirmado", txId: tx.id } };
  } catch (e) {
    return friendlyError(e);
  }
}

/** "Esta vez no aplica / ya lo había anotado". */
export async function skipOccurrenceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const itemId = z.uuid().safeParse(field(formData, "itemId"));
  const dueDate = isoDateSchema.safeParse(field(formData, "dueDate"));
  if (!itemId.success || !dueDate.success) return { message: "No encontramos esa fecha." };
  try {
    await getDb().transaction((t) => skipOccurrence(t, actor, itemId.data, dueDate.data));
    revalidatePath("/", "layout");
    return { data: { done: "omitido" } };
  } catch (e) {
    return friendlyError(e);
  }
}

export async function undoOccurrenceAction(itemId: string, dueDate: string): Promise<FormState> {
  const actor = await requireUser();
  try {
    await getDb().transaction((t) =>
      undoOccurrence(t, actor, z.uuid().parse(itemId), isoDateSchema.parse(dueDate)),
    );
    revalidatePath("/", "layout");
    return { data: { done: "deshecho" } };
  } catch (e) {
    return friendlyError(e);
  }
}
