import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { serverEnv } from "@/server/env";
import { type SessionUser, validateSession } from "./sessions";

export const SESSION_COOKIE = "fin_sesion";

/** Usuario de la petición actual (o null). Se memoriza por petición. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(getDb(), token);
});

/** Para páginas y acciones privadas: si no hay sesión, manda al login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: serverEnv().COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function readSessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** IP del cliente. Nginx pone X-Real-IP; nunca se confía en lo que mande el navegador directamente. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "desconocida";
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

