import "server-only";
import { cache } from "react";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { syncAutoOccurrences } from "@/server/services/scheduled";

/**
 * Registra domiciliados/depósitos automáticos que ya llegaron. Una sola vez por petición:
 * layout y páginas pueden llamarlo y esperan la misma promesa (se renderizan en paralelo).
 */
export const ensureAutoSynced = cache(async () => {
  const user = await requireUser();
  try {
    await syncAutoOccurrences(getDb(), user);
  } catch (e) {
    console.error("No se pudieron registrar los automáticos", e);
  }
});
