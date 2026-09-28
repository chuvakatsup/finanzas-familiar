/**
 * Datos de ejemplo SOLO para desarrollo/pruebas: un grupo con "Mamá" (miembro) e "Hijo" (admin),
 * con cuentas y algunos movimientos del mes.
 *   pnpm db:seed
 */
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@/server/db";
import { accounts, categories, households, installmentPurchases, loans, scheduledItems, transactions, users } from "@/server/db/schema";
import { createInstallmentPurchase } from "@/server/services/msi";
import { createLoan } from "@/server/services/loans";
import { hashPassword } from "@/server/auth/password";
import type { Actor } from "@/server/authz";
import { createAccount } from "@/server/services/accounts";
import { ensureUserDefaults } from "@/server/services/categories";
import { createExpense, createIncome, createTransfer } from "@/server/services/transactions";
import { createScheduled } from "@/server/services/scheduled";
import { addDays } from "@/domain/recurrence";
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

/** Ingresos fijos y pagos recurrentes de ejemplo. */
async function sampleScheduled(actor: Actor, kind: "mama" | "hijo") {
  const accs = await db.select().from(accounts).where(eq(accounts.userId, actor.id));
  const debito = accs.find((a) => a.kind === "debito")!;
  const credito = accs.find((a) => a.kind === "credito")!;
  const cat = (n: string) => categoryId(actor.id, n);
  const base = { amountIsEstimate: false, nextDate: null, day1: null, day2: null, autoRegister: false };
  const today = todayIso();
  const items =
    kind === "mama"
      ? [
          { ...base, kind: "ingreso" as const, name: "Pensión IMSS", amount: 600000, frequency: "quincenal" as const, day1: 15, day2: 31, accountId: debito.id, categoryId: await cat("Pensión"), autoRegister: true },
          { ...base, kind: "pago" as const, name: "Luz CFE", amount: 45000, amountIsEstimate: true, frequency: "bimestral" as const, nextDate: addDays(today, 6), accountId: debito.id, categoryId: await cat("Luz, agua y gas") },
          { ...base, kind: "pago" as const, name: "Teléfono Telmex", amount: 39900, frequency: "mensual" as const, day1: 10, accountId: debito.id, categoryId: await cat("Teléfono e internet"), autoRegister: true },
          { ...base, kind: "pago" as const, name: "Agua", amount: 18000, amountIsEstimate: true, frequency: "mensual" as const, day1: 20, accountId: debito.id, categoryId: await cat("Luz, agua y gas") },
        ]
      : [
          { ...base, kind: "ingreso" as const, name: "Sueldo", amount: 925000, frequency: "quincenal" as const, day1: 15, day2: 31, accountId: debito.id, categoryId: await cat("Sueldo") },
          { ...base, kind: "pago" as const, name: "Renta", amount: 800000, frequency: "mensual" as const, day1: 1, accountId: debito.id, categoryId: await cat("Casa") },
          { ...base, kind: "pago" as const, name: "Netflix", amount: 29900, frequency: "mensual" as const, day1: 3, accountId: credito.id, categoryId: await cat("Diversión"), autoRegister: true },
        ];
  for (const item of items) await createScheduled(db, actor, item);
}

/** Tarjeta con corte/pago, compra a meses ya iniciada y un préstamo. */
async function sampleCredit(actor: Actor, kind: "mama" | "hijo") {
  const accs = await db.select().from(accounts).where(eq(accounts.userId, actor.id));
  const debito = accs.find((a) => a.kind === "debito")!;
  const credito = accs.find((a) => a.kind === "credito")!;
  await db.update(accounts).set({ statementDay: 5, paymentDueDay: 25, interestRateBp: 4500 }).where(eq(accounts.id, credito.id));
  const today = todayIso();
  if (kind === "mama") {
    await createInstallmentPurchase(db, actor, {
      cardAccountId: credito.id, description: "Refrigerador", categoryId: await categoryId(actor.id, "Casa"),
      principal: 1200000, months: 12, withInterest: false, annualRateBp: 0, ivaPct: 0,
      purchaseDate: "2026-01-20", firstDueDate: "2026-02-25", paidBefore: 7,
    });
    await createLoan(db, actor, {
      name: "Mi hijo Daniel", informal: true, principal: 600000, annualRateBp: 0, ivaPct: 0, periodicity: "mensual",
      nPayments: 6, firstPaymentDate: addDays(today, 3), openingFee: null, catBp: null, payFromAccountId: debito.id,
      paidBefore: 0, currentBalance: null,
    });
  } else {
    await createLoan(db, actor, {
      name: "Crédito auto BBVA", informal: false, principal: 15000000, annualRateBp: 1450, ivaPct: 16, periodicity: "mensual",
      nPayments: 36, firstPaymentDate: "2026-01-10", openingFee: 300000, catBp: 2210, payFromAccountId: debito.id,
      paidBefore: 8, currentBalance: null,
    });
  }
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
    const actor = { id: u.id, householdId: u.householdId, role: u.role };
    if (!hasTx) await sampleData(actor, key);
    const [hasScheduled] = await db.select({ id: scheduledItems.id }).from(scheduledItems).where(eq(scheduledItems.userId, u.id)).limit(1);
    if (!hasScheduled) await sampleScheduled(actor, key);
    const [hasLoan] = await db.select({ id: loans.id }).from(loans).where(eq(loans.userId, u.id)).limit(1);
    const [hasMsi] = await db.select({ id: installmentPurchases.id }).from(installmentPurchases).where(eq(installmentPurchases.userId, u.id)).limit(1);
    if (!hasLoan && !hasMsi) await sampleCredit(actor, key);
  }
  console.log("✔ Seed listo:");
  console.log(`  Hijo (admin): ${DEMO.hijo.email} / ${DEMO.hijo.password}`);
  console.log(`  Mamá:         ${DEMO.mama.email} / ${DEMO.mama.password}`);
} finally {
  await closeDb();
}
