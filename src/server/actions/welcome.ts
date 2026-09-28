"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { adjustBalance, createAccount, listAccounts } from "@/server/services/accounts";
import { listCategories } from "@/server/services/categories";
import { createScheduled } from "@/server/services/scheduled";
import { amountOrZeroSchema, amountSchema, isoDateSchema } from "@/lib/schemas/finance";
import { type FormState, fieldErrors } from "@/lib/form-state";
import { field, friendlyError } from "./helpers";
import { todayIso } from "@/domain/dates";
import { LAST_DAY } from "@/domain/recurrence";
import { COMMON_PAYMENTS } from "@/domain/welcome";

const on = (f: FormData, n: string) => f.get(n) === "on";
const day = z.coerce.number().int().min(1).max(LAST_DAY);

// ---------------- Paso 1: dinero y tarjetas ----------------

const step1Schema = z.object({
  cash: amountOrZeroSchema,
  hasBank: z.boolean(),
  bankName: z.string().trim().max(40),
  bankBalance: amountOrZeroSchema,
  hasCard: z.boolean(),
  cardName: z.string().trim().max(40),
  cardDebt: amountOrZeroSchema,
  cardDueDay: z.string().trim(),
});

export async function welcomeAccountsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = step1Schema.safeParse({
    cash: field(formData, "cash"),
    hasBank: on(formData, "hasBank"),
    bankName: field(formData, "bankName"),
    bankBalance: field(formData, "bankBalance"),
    hasCard: on(formData, "hasCard"),
    cardName: field(formData, "cardName"),
    cardDebt: field(formData, "cardDebt"),
    cardDueDay: field(formData, "cardDueDay"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const dueDay = d.cardDueDay ? day.safeParse(d.cardDueDay) : null;
  if (dueDay && !dueDay.success) return { fieldErrors: { cardDueDay: ["Escribe un día del 1 al 31."] } };
  try {
    await getDb().transaction(async (t) => {
      const accounts = await listAccounts(t, actor);
      const cash = accounts.find((a) => a.kind === "efectivo");
      if (cash && d.cash > 0) await adjustBalance(t, actor, cash.id, d.cash);
      const none = { last4: null, creditLimit: null, statementDay: null, paymentDueDay: null };
      if (d.hasBank) {
        await createAccount(t, actor, { ...none, kind: "debito", name: d.bankName || "Mi banco", balance: d.bankBalance });
      }
      if (d.hasCard) {
        await createAccount(t, actor, {
          ...none,
          kind: "credito",
          name: d.cardName || "Mi tarjeta",
          balance: d.cardDebt,
          paymentDueDay: dueDay?.success ? dueDay.data : null,
        });
      }
    });
  } catch (e) {
    return friendlyError(e);
  }
  revalidatePath("/", "layout");
  redirect("/bienvenida?paso=2");
}

// ---------------- Paso 2: lo que te llega ----------------

export async function welcomeIncomeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const frequency = field(formData, "frequency");
  if (frequency === "ninguno") redirect("/bienvenida?paso=3");
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Escribe de qué es.").max(40),
      amount: amountSchema,
      frequency: z.enum(["quincenal", "mensual", "semanal"], { error: "Elige cada cuándo te llega." }),
      day1: z.string(),
      day2: z.string(),
      nextDate: z.string(),
      accountId: z.uuid({ error: "Elige a dónde te llega." }),
      autoRegister: z.boolean(),
    })
    .safeParse({
      name: field(formData, "name"),
      amount: field(formData, "amount"),
      frequency,
      day1: field(formData, "day1"),
      day2: field(formData, "day2"),
      nextDate: field(formData, "nextDate"),
      accountId: field(formData, "accountId"),
      autoRegister: on(formData, "autoRegister"),
    });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  try {
    await getDb().transaction(async (t) => {
      const cats = await listCategories(t, actor, "ingreso");
      const lower = d.name.toLowerCase();
      const category =
        cats.find((c) => c.name.toLowerCase() === lower) ??
        cats.find((c) => lower.includes(c.name.toLowerCase())) ??
        cats.find((c) => c.name === "Otros ingresos") ??
        cats[0];
      await createScheduled(t, actor, {
        kind: "ingreso",
        name: d.name,
        amount: d.amount,
        amountIsEstimate: false,
        frequency: d.frequency,
        nextDate: d.frequency === "semanal" ? isoDateSchema.parse(d.nextDate || todayIso()) : null,
        day1: d.frequency === "semanal" ? null : day.parse(d.day1 || 15),
        day2: d.frequency === "quincenal" ? day.parse(d.day2 || LAST_DAY) : null,
        accountId: d.accountId,
        categoryId: category.id,
        autoRegister: d.autoRegister,
      });
    });
  } catch (e) {
    return friendlyError(e);
  }
  revalidatePath("/", "layout");
  redirect("/bienvenida?paso=3");
}

// ---------------- Paso 3: pagos fijos ----------------

export async function welcomePaymentsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const accountId = z.uuid().safeParse(field(formData, "accountId"));
  if (!accountId.success) return { fieldErrors: { accountId: ["Elige con qué pagas."] } };
  const errors: Record<string, string[]> = {};
  const rows: { p: (typeof COMMON_PAYMENTS)[number]; amount: number; day1: number | null; nextDate: string | null }[] = [];
  for (const p of COMMON_PAYMENTS) {
    if (!on(formData, `${p.key}_on`)) continue;
    const amount = amountSchema.safeParse(field(formData, `${p.key}_amount`));
    if (!amount.success) {
      errors[`${p.key}_amount`] = [amount.error.issues[0].message];
      continue;
    }
    if (p.frequency === "bimestral") {
      const date = isoDateSchema.safeParse(field(formData, `${p.key}_date`));
      if (!date.success) errors[`${p.key}_date`] = ["Elige la fecha del próximo recibo."];
      else rows.push({ p, amount: amount.data, day1: null, nextDate: date.data });
    } else {
      const d = day.safeParse(field(formData, `${p.key}_day`));
      if (!d.success) errors[`${p.key}_day`] = ["Elige el día."];
      else rows.push({ p, amount: amount.data, day1: d.data, nextDate: null });
    }
  }
  if (Object.keys(errors).length) return { fieldErrors: errors };
  try {
    await getDb().transaction(async (t) => {
      const cats = await listCategories(t, actor, "gasto");
      for (const r of rows) {
        const category = cats.find((c) => c.name === r.p.category) ?? cats[0];
        await createScheduled(t, actor, {
          kind: "pago",
          name: r.p.name,
          amount: r.amount,
          amountIsEstimate: r.p.estimate,
          frequency: r.p.frequency,
          nextDate: r.nextDate,
          day1: r.day1,
          day2: null,
          accountId: accountId.data,
          categoryId: category.id,
          autoRegister: false,
        });
      }
    });
  } catch (e) {
    return friendlyError(e);
  }
  revalidatePath("/", "layout");
  redirect("/bienvenida?paso=listo");
}
