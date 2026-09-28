"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { serverEnv } from "@/server/env";
import { requireUser } from "@/server/auth/current";
import { createInvitation, revokeInvitation } from "@/server/services/invitations";
import { createPasswordResetForMember } from "@/server/services/password-reset";
import { createInvitationSchema } from "@/lib/schemas/auth";
import type { FormState } from "@/lib/form-state";
import { friendlyError } from "./helpers";

function link(path: string) {
  return new URL(path, serverEnv().APP_URL).toString();
}

export async function createInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = createInvitationSchema.safeParse({
    suggestedName: formData.get("suggestedName") || undefined,
  });
  if (!parsed.success) return { message: "Revisa el nombre." };
  try {
    const inv = await getDb().transaction((tx) => createInvitation(tx, actor, parsed.data));
    revalidatePath("/mas/familia");
    return { data: { link: link(`/invitacion/${inv.token}`), name: parsed.data.suggestedName ?? "" } };
  } catch (e) {
    return friendlyError(e);
  }
}

export async function revokeInvitationAction(formData: FormData) {
  const actor = await requireUser();
  const id = z.uuid().parse(formData.get("id"));
  await getDb().transaction((tx) => revokeInvitation(tx, actor, id));
  revalidatePath("/mas/familia");
}

export async function createResetLinkAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const userId = z.uuid().safeParse(formData.get("userId"));
  if (!userId.success) return { message: "No encontramos a esa persona." };
  try {
    const reset = await getDb().transaction((tx) =>
      createPasswordResetForMember(tx, actor, userId.data),
    );
    return { data: { link: link(`/restablecer/${reset.token}`), name: reset.name } };
  } catch (e) {
    return friendlyError(e);
  }
}
