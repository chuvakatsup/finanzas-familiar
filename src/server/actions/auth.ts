"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import {
  clearSessionCookie,
  clientIp,
  readSessionToken,
  setSessionCookie,
  userAgent,
} from "@/server/auth/current";
import { deleteSession } from "@/server/auth/sessions";
import { isLimited, recordAttempt } from "@/server/auth/rate-limit";
import { login } from "@/server/services/auth";
import { acceptInvitation } from "@/server/services/invitations";
import { completePasswordReset } from "@/server/services/password-reset";
import { acceptInvitationSchema, loginSchema, newPasswordSchema } from "@/lib/schemas/auth";
import { type FormState, fieldErrors } from "@/lib/form-state";

const BLOQUEADO =
  "Por seguridad hicimos una pausa por muchos intentos. Espera 15 minutos y vuelve a intentar.";

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const result = await login(getDb(), {
    ...parsed.data,
    ip: await clientIp(),
    userAgent: await userAgent(),
  });
  if (!result.ok) {
    return {
      message:
        result.error === "bloqueado"
          ? BLOQUEADO
          : "El correo o la contraseña no coinciden. Revisa y vuelve a intentar.",
    };
  }
  await setSessionCookie(result.token, result.expiresAt);
  redirect("/");
}

export async function logoutAction() {
  const token = await readSessionToken();
  if (token) await deleteSession(getDb(), token);
  await clearSessionCookie();
  redirect("/login");
}

/** Límite por IP para páginas con enlace secreto (invitación y contraseña nueva). */
async function tokenGuard() {
  const ip = await clientIp();
  const limited = await isLimited(getDb(), "token-ip", ip);
  return { ip, limited };
}

export async function acceptInvitationAction(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { ip, limited } = await tokenGuard();
  if (limited) return { message: BLOQUEADO };

  const parsed = acceptInvitationSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const ua = await userAgent();
  const result = await getDb().transaction((tx) => acceptInvitation(tx, token, parsed.data, ua));
  await recordAttempt(getDb(), "token-ip", ip, result.ok);
  if (!result.ok) {
    return result.error === "correo-existe"
      ? { fieldErrors: { email: ["Ese correo ya tiene cuenta. Usa otro o inicia sesión."] } }
      : { message: "Esta invitación ya no sirve (venció o ya se usó). Pide una nueva." };
  }
  await setSessionCookie(result.token, result.expiresAt);
  redirect("/");
}

export async function resetPasswordAction(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { ip, limited } = await tokenGuard();
  if (limited) return { message: BLOQUEADO };

  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const ua = await userAgent();
  const session = await getDb().transaction((tx) =>
    completePasswordReset(tx, token, parsed.data.password, ua),
  );
  await recordAttempt(getDb(), "token-ip", ip, Boolean(session));
  if (!session) return { message: "Este enlace ya no sirve (venció o ya se usó). Pide uno nuevo." };
  await setSessionCookie(session.token, session.expiresAt);
  redirect("/");
}
