/**
 * Datos de ejemplo SOLO para desarrollo/pruebas: un grupo con "Mamá" (miembro) e "Hijo" (admin).
 *   pnpm db:seed
 */
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/server/db";
import { households, users } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";

if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW !== "1") {
  console.error("✖ El seed no se ejecuta en producción (usa SEED_ALLOW=1 si de verdad lo quieres).");
  process.exit(1);
}

export const DEMO = {
  household: "Familia Demo",
  hijo: { name: "Daniel", email: "hijo@demo.local", password: "demo-hijo-1234" },
  mama: { name: "Mamá", email: "mama@demo.local", password: "demo-mama-1234" },
};

const db = getDb();
try {
  const [exists] = await db.select().from(users).where(eq(users.email, DEMO.hijo.email)).limit(1);
  if (exists) {
    console.log("• El seed ya estaba cargado.");
  } else {
    await db.transaction(async (tx) => {
      const [h] = await tx.insert(households).values({ name: DEMO.household }).returning();
      await tx.insert(users).values([
        {
          householdId: h.id,
          name: DEMO.hijo.name,
          email: DEMO.hijo.email,
          passwordHash: await hashPassword(DEMO.hijo.password),
          role: "admin",
        },
        {
          householdId: h.id,
          name: DEMO.mama.name,
          email: DEMO.mama.email,
          passwordHash: await hashPassword(DEMO.mama.password),
          role: "miembro",
        },
      ]);
    });
    console.log("✔ Seed cargado:");
  }
  console.log(`  Hijo (admin): ${DEMO.hijo.email} / ${DEMO.hijo.password}`);
  console.log(`  Mamá:         ${DEMO.mama.email} / ${DEMO.mama.password}`);
} finally {
  await closeDb();
}
