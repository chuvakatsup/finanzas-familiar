"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { writeDisplayPrefs } from "@/server/auth/display-prefs";
import { saveBudgets } from "@/server/services/budget";
import { updatePrefs } from "@/server/services/prefs";
import { LETRA_CHOICES, TEMA_CHOICES, budgetFormSchema } from "@/lib/schemas/finance";
import { type FormState, fieldErrors } from "@/lib/form-state";
import { field, friendlyError } from "./helpers";

export async function saveBudgetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const byCategory: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("cat_") && typeof value === "string") byCategory[key.slice(4)] = value;
  }
  const parsed = budgetFormSchema.safeParse({
    general: field(formData, "general"),
    warnPct: field(formData, "warnPct"),
    byCategory,
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    await getDb().transaction(async (t) => {
      await saveBudgets(t, actor, { general: parsed.data.general || null, byCategory: parsed.data.byCategory });
      await updatePrefs(t, actor, { umbralAmarillo: parsed.data.warnPct });
    });
  } catch (e) {
    return friendlyError(e);
  }
  revalidatePath("/", "layout");
  return { data: { saved: "1" } };
}

export async function setLetraAction(letra: (typeof LETRA_CHOICES)[number]) {
  const actor = await requireUser();
  if (!LETRA_CHOICES.includes(letra)) return;
  await updatePrefs(getDb(), actor, { letra });
  await writeDisplayPrefs({ letra });
  revalidatePath("/", "layout");
}

export async function setTemaAction(tema: (typeof TEMA_CHOICES)[number]) {
  const actor = await requireUser();
  if (!TEMA_CHOICES.includes(tema)) return;
  await updatePrefs(getDb(), actor, { tema });
  await writeDisplayPrefs({ tema });
  revalidatePath("/", "layout");
}

/** Termina (o salta) el asistente de primer uso. */
export async function finishWelcomeAction() {
  const actor = await requireUser();
  await updatePrefs(getDb(), actor, { bienvenidaHecha: true });
  revalidatePath("/", "layout");
  redirect("/");
}
