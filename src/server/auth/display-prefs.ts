import "server-only";
import { cookies } from "next/headers";
import type { UserPrefs } from "@/server/db/schema";
import { serverEnv } from "@/server/env";

// Tamaño de letra y tema viven también en cookies para aplicarse desde el layout raíz
// (antes de saber quién es la persona y sin consultar la BD en cada página).
const LETRA = "fin_letra";
const TEMA = "fin_tema";
const YEAR = 365 * 86_400;

export async function readDisplayPrefs() {
  const c = await cookies();
  const letra = c.get(LETRA)?.value;
  const tema = c.get(TEMA)?.value;
  return {
    letra: letra === "grande" || letra === "muy-grande" ? letra : "normal",
    tema: tema === "claro" || tema === "oscuro" ? tema : "sistema",
  } as const;
}

export async function writeDisplayPrefs(prefs: Pick<UserPrefs, "letra" | "tema">) {
  const c = await cookies();
  const opts = { httpOnly: true, secure: serverEnv().COOKIE_SECURE, sameSite: "lax" as const, path: "/", maxAge: YEAR };
  if (prefs.letra) c.set(LETRA, prefs.letra, opts);
  if (prefs.tema) c.set(TEMA, prefs.tema, opts);
}
