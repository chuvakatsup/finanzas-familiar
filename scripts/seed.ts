/**
 * Datos de ejemplo SOLO para desarrollo/pruebas: un grupo con "Mamá" (miembro) e "Hijo" (admin),
 * con cuentas y algunos movimientos del mes.
 *   pnpm db:seed
 */
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@/server/db";
import { accounts, categories, households, transactions, users } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import type { Actor } from "@/server/authz";
import { createAccount } from "@/server/services/accounts";
import { ensureUserDefaults } from "@/server/services/categories";
import { createExpense, createIncome, createTransfer } from "@/server/services/transactions";
import { todayIso } from "@/domain/dates";

if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW !== "1") {
  console.error("✖ El seed no se ejecuta en producción (usa SEED_ALLOW=1 si de verdad lo quieres).");
  process.exit(1);
}

const DEMO = {
  household: "Familia Demo",
  hijo: { name: "Daniel", email: "hijo@demo.local", password: "demo-hijo-1234" },
  mama: { name: "Mamá", email: "mama@demo.local", password: "demo-mama-1234" },
};

const db = getDb();

/** Día del mes actual (sin pasarse de hoy). */
function day(n: number) {
  const today = todayIso();
  const d = Math.min(n, Number(today.slice(8, 10)));
  return `${today.slice(0, 8)}${String(d).padStart(2, "0")}`;
}

async function categoryId(userId: string, name: string) {
  const [c] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.name, name)))
    .limit(1);
  return c.id;
}

async function sampleData(actor: Actor, kind: "mama" | "hijo") {
  const [efectivo] = await db.select().from(accounts).where(eq(accounts.userId, actor.id)).limit(1);
  const debito = await createAccount(db, actor, {
    kind: "debito",
    name: kind === "mama" ? "Banorte pensión" : "BBVA nómina",
    balance: kind === "mama" ? 850000 : 1520000,
    last4: kind === "mama" ? "4821" : "1177",
    creditLimit: null,
    statementDay: null,
    paymentDueDay: null,
  });
  const credito = await createAccount(db, actor, {
    kind: "credito",
    name: kind === "mama" ? "Liverpool" : "BBVA Azul",
    balance: kind === "mama" ? 320000 : 1245000,
    last4: null,
    creditLimit: kind === "mama" ? 2000000 : 6000000,
    statementDay: 5,
    paymentDueDay: 25,
  });
  const cat = (n: string) => categoryId(actor.id, n);
  await createIncome(db, actor, {
    amount: kind === "mama" ? 1200000 : 1850000,
    categoryId: await cat(kind === "mama" ? "Pensión" : "Sueldo"),
    accountId: debito.id,
    date: day(1),
    note: null,
  });
  await createExpense(db, actor, { amount: 45050, categoryId: await cat("Súper"), accountId: debito.id, date: day(2), note: "Soriana" });
  await createExpense(db, actor, { amount: 12000, categoryId: await cat("Comida"), accountId: efectivo.id, date: day(3), note: null });
  await createExpense(db, actor, { amount: 38000, categoryId: await cat("Salud"), accountId: credito.id, date: day(4), note: "Farmacia" });
  await createExpense(db, actor, { amount: 5000, categoryId: await cat("Transporte"), accountId: efectivo.id, date: day(5), note: "Camión" });
  await createTransfer(db, actor, { amount: 200000, fromAccountId: debito.id, toAccountId: efectivo.id, date: day(2), note: "Retiro cajero" });
  await createTransfer(db, actor, { amount: 150000, fromAccountId: debito.id, toAccountId: credito.id, date: day(6), note: null });
}

try {
  let [h] = await db.select().from(households).where(eq(households.name, DEMO.household)).limit(1);
  if (!h) [h] = await db.insert(households).values({ name: DEMO.household }).returning();

  for (const [key, role] of [["hijo", "admin"], ["mama", "miembro"]] as const) {
    const info = DEMO[key];
    let [u] = await db.select().from(users).where(eq(users.email, info.email)).limit(1);
    if (!u) {
      [u] = await db
        .insert(users)
        .values({ householdId: h.id, name: info.name, email: info.email, passwordHash: await hashPassword(info.password), role })
        .returning();
    }
    await ensureUserDefaults(db, u.id);
    const [hasTx] = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.userId, u.id)).limit(1);
    if (!hasTx) {
      await sampleData({ id: u.id, householdId: u.householdId, role: u.role }, key);
    }
  }
  console.log("✔ Seed listo:");
  console.log(`  Hijo (admin): ${DEMO.hijo.email} / ${DEMO.hijo.password}`);
  console.log(`  Mamá:         ${DEMO.mama.email} / ${DEMO.mama.password}`);
} finally {
  await closeDb();
}
