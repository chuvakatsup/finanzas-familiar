"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import {
  confirmSharedReceived,
  dismissRejectedShared,
  markSharedPaid,
  rejectShared,
  shareExpense,
  undoRejectShared,
  undoSharedPaid,
  undoSharedReceived,
  unshareExpense,
} from "@/server/services/shared";
import { notifySharedCreated, notifySharedPaid } from "@/server/services/reminders";
import { shareSchema, sharedPaySchema, sharedReceiveSchema } from "@/lib/schemas/finance";
import { type FormState, fieldErrors } from "@/lib/form-state";
import { field, friendlyError } from "./helpers";

const refresh = () => revalidatePath("/", "layout");
const idOf = (v: string) => z.uuid().parse(v);

/** Compartir un gasto que ya estaba registrado (desde su detalle). */
export async function shareExpenseAction(txId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = shareSchema.safeParse(field(formData, "shared"));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  if (!parsed.data) return { message: "Elige con quién compartes el gasto." };
  const input = parsed.data;
  let debts: Awaited<ReturnType<typeof shareExpense>>;
  try {
    debts = await getDb().transaction((t) => shareExpense(t, actor, idOf(txId), input));
  } catch (e) {
    return friendlyError(e);
  }
  await notifySharedCreated(getDb(), debts).catch((e) => console.error("push compartido", e));
  refresh();
  redirect(`/movimientos/${idOf(txId)}?compartido=1`);
}

export async function unshareExpenseAction(formData: FormData) {
  const actor = await requireUser();
  const txId = idOf(field(formData, "txId"));
  let error: string | undefined;
  try {
    await getDb().transaction((t) => unshareExpense(t, actor, txId));
  } catch (e) {
    error = friendlyError(e).message;
  }
  refresh();
  redirect(`/movimientos/${txId}?${error ? `error=${encodeURIComponent(error)}` : "sinReparto=1"}`);
}

/** Quien debe: "Ya te pagué". */
export async function markSharedPaidAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = sharedPaySchema.safeParse({ fromAccountId: field(formData, "fromAccountId") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  let debt: Awaited<ReturnType<typeof markSharedPaid>>;
  try {
    debt = await getDb().transaction((t) => markSharedPaid(t, actor, idOf(id), parsed.data));
  } catch (e) {
    return friendlyError(e);
  }
  await notifySharedPaid(getDb(), debt).catch((e) => console.error("push compartido pagado", e));
  refresh();
  return { data: { done: "pagado" } };
}

/** Dueño: "Sí, me llegó". */
export async function confirmSharedReceivedAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = sharedReceiveSchema.safeParse({ accountId: field(formData, "accountId") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    await getDb().transaction((t) => confirmSharedReceived(t, actor, idOf(id), parsed.data));
    refresh();
    return { data: { done: "recibido" } };
  } catch (e) {
    return friendlyError(e);
  }
}

/** Acciones de un toque (deshacer, rechazar, "Entendido"). */
const SIMPLE = {
  "deshacer-pago": undoSharedPaid,
  "deshacer-recibido": undoSharedReceived,
  rechazar: rejectShared,
  "deshacer-rechazo": undoRejectShared,
  entendido: dismissRejectedShared,
} as const;

export type SharedSimpleAction = keyof typeof SIMPLE;

export async function sharedSimpleAction(id: string, what: SharedSimpleAction): Promise<FormState> {
  const actor = await requireUser();
  const fn = SIMPLE[what];
  if (!fn) return { message: "Algo salió mal. Intenta de nuevo en un momento." };
  try {
    await getDb().transaction((t) => fn(t, actor, idOf(id)));
    refresh();
    return { data: { done: what } };
  } catch (e) {
    return friendlyError(e);
  }
}
