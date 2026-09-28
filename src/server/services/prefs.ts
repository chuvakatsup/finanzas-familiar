import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { type UserPrefs, users } from "@/server/db/schema";
import type { Actor } from "@/server/authz";

export const DEFAULT_WARN_PCT = 10;

export async function getPrefs(db: DbOrTx, actor: Actor): Promise<UserPrefs> {
  const [row] = await db.select({ prefs: users.prefs }).from(users).where(eq(users.id, actor.id)).limit(1);
  return row?.prefs ?? {};
}

/** Mezcla los cambios con las preferencias guardadas (sin tocar otras llaves). */
export async function updatePrefs(db: DbOrTx, actor: Actor, patch: Partial<UserPrefs>) {
  await db
    .update(users)
    .set({ prefs: sql`${users.prefs} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
    .where(eq(users.id, actor.id));
}

export function warnPct(prefs: UserPrefs) {
  return prefs.umbralAmarillo ?? DEFAULT_WARN_PCT;
}
