import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { households, users } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import type { Actor } from "@/server/authz";
import { ensureUserDefaults } from "@/server/services/categories";

/** Borra todos los datos (se llama en beforeEach). */
export async function resetDb() {
  await getDb().execute(sql`
    truncate table transactions, categories, accounts, audit_log, auth_attempts, password_reset_tokens, invitations, sessions, users, households
    restart identity cascade
  `);
}

let counter = 0;

/** Crea un grupo con un admin y un miembro. Contraseña de ambos: "contraseña-segura". */
export async function makeHousehold(name = "Familia") {
  const db = getDb();
  counter += 1;
  const [h] = await db.insert(households).values({ name: `${name} ${counter}` }).returning();
  const passwordHash = await hashPassword("contraseña-segura");
  const [admin, member] = await db
    .insert(users)
    .values([
      { householdId: h.id, name: "Admin", email: `admin${counter}@test.local`, passwordHash, role: "admin" },
      { householdId: h.id, name: "Miembro", email: `miembro${counter}@test.local`, passwordHash, role: "miembro" },
    ])
    .returning();
  const toActor = (u: typeof admin): Actor & { email: string } => ({
    id: u.id,
    householdId: u.householdId,
    role: u.role,
    email: u.email,
  });
  await ensureUserDefaults(db, admin.id);
  await ensureUserDefaults(db, member.id);
  return { household: h, admin: toActor(admin), member: toActor(member) };
}
