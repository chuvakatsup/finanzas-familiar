import { z } from "zod";
import { CREATABLE_ACCOUNT_KINDS } from "@/domain/accounts";
import { CATEGORY_KINDS } from "@/domain/categories";
import { parseMoney } from "@/domain/money";
import { FREQUENCIES } from "@/domain/recurrence";
import { PERIODICITIES, parseRatePct } from "@/domain/amortization";
import { SPLIT_MODES, parsePartValue } from "@/domain/shared";

/** Tope de seguridad: 100 millones de pesos. */
const MAX_CENTS = 10_000_000_000;

/** Texto de dinero escrito por la persona → centavos (> 0). */
export const amountSchema = z
  .string({ error: "Escribe cuánto fue." })
  .trim()
  .min(1, "Escribe cuánto fue.")
  .transform((v, ctx) => {
    const cents = parseMoney(v);
    if (cents == null) {
      ctx.addIssue({ code: "custom", message: "Ese monto no se entiende. Usa solo números, por ejemplo 150.50" });
      return z.NEVER;
    }
    if (cents <= 0) {
      ctx.addIssue({ code: "custom", message: "El monto debe ser mayor a cero." });
      return z.NEVER;
    }
    if (cents > MAX_CENTS) {
      ctx.addIssue({ code: "custom", message: "Ese monto es demasiado grande. Revísalo." });
      return z.NEVER;
    }
    return cents;
  });

/** Igual pero permite 0 y vacío (vacío = 0). Para saldos iniciales. */
export const amountOrZeroSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return 0;
    const cents = parseMoney(v);
    if (cents == null || cents > MAX_CENTS) {
      ctx.addIssue({ code: "custom", message: "Ese monto no se entiende. Usa solo números, por ejemplo 1500" });
      return z.NEVER;
    }
    return cents;
  });

const optionalAmount = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const cents = parseMoney(v);
    if (cents == null || cents > MAX_CENTS) {
      ctx.addIssue({ code: "custom", message: "Ese monto no se entiende. Usa solo números." });
      return z.NEVER;
    }
    return cents;
  });

const optionalDay = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 31) {
      ctx.addIssue({ code: "custom", message: "Escribe un día del 1 al 31." });
      return z.NEVER;
    }
    return n;
  });

export const isoDateSchema = z.iso.date({ error: "Revisa la fecha." });

const note = z
  .string()
  .trim()
  .max(200, "La nota es muy larga (máximo 200 letras).")
  .transform((v) => v || null);

const id = z.uuid({ error: "Elige una opción." });

export const accountFormSchema = z.object({
  kind: z.enum(CREATABLE_ACCOUNT_KINDS, { error: "Elige qué tipo de cuenta es." }),
  name: z.string().trim().min(1, "Ponle un nombre, por ejemplo “BBVA nómina”.").max(40, "Nombre muy largo."),
  /** Efectivo/débito/ahorro: cuánto tienes. Crédito: cuánto debes. */
  balance: amountOrZeroSchema,
  last4: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}$/.test(v), "Solo los últimos 4 números de la tarjeta.")
    .transform((v) => v || null),
  creditLimit: optionalAmount,
  statementDay: optionalDay,
  paymentDueDay: optionalDay,
  /** Tasa anual de la tarjeta (%), opcional. */
  interestRateBp: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const bp = parseRatePct(v);
      if (bp == null) {
        ctx.addIssue({ code: "custom", message: "Escribe la tasa como número, por ejemplo 42.5" });
        return z.NEVER;
      }
      return bp;
    }),
});
export type AccountFormInput = z.infer<typeof accountFormSchema>;

export const accountEditSchema = accountFormSchema.omit({ kind: true, balance: true });

export const adjustBalanceSchema = z.object({
  /** Efectivo/débito/ahorro: cuánto tienes de verdad. Crédito: cuánto debes de verdad. */
  realBalance: amountOrZeroSchema,
});

export const expenseSchema = z.object({
  amount: amountSchema,
  categoryId: id,
  accountId: id,
  date: isoDateSchema,
  note,
});

export const incomeSchema = expenseSchema;

export const transferSchema = z
  .object({
    amount: amountSchema,
    fromAccountId: id,
    toAccountId: id,
    date: isoDateSchema,
    note,
  })
  .refine((d) => d.fromAccountId !== d.toAccountId, {
    message: "Elige dos cuentas diferentes.",
    path: ["toAccountId"],
  });

export const categoryFormSchema = z.object({
  kind: z.enum(CATEGORY_KINDS),
  name: z.string().trim().min(1, "Escribe un nombre.").max(30, "Nombre muy largo."),
  icon: z.string().trim().min(1, "Elige un dibujito.").max(8),
});

export const historyFiltersSchema = z.object({
  mes: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .catch(undefined),
  cuenta: z.uuid().optional().catch(undefined),
  categoria: z.uuid().optional().catch(undefined),
  q: z.string().trim().max(60).optional().catch(undefined),
});

// ---------------- Programados (ingresos fijos y pagos recurrentes) ----------------

const dayOfMonth = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 31) {
      ctx.addIssue({ code: "custom", message: "Elige un día del 1 al 31 (o “último”)." });
      return z.NEVER;
    }
    return n;
  });

export const scheduledFormSchema = z
  .object({
    kind: z.enum(["ingreso", "pago"]),
    name: z.string().trim().min(1, "Ponle un nombre, por ejemplo “Luz” o “Pensión”.").max(40, "Nombre muy largo."),
    amount: amountSchema,
    amountIsEstimate: z.boolean(),
    frequency: z.enum(FREQUENCIES, { error: "Elige cada cuándo toca." }),
    /** Próxima fecha (semanal, catorcenal, bimestral, anual, única). */
    nextDate: z.string().trim(),
    day1: z.string().trim(),
    day2: z.string().trim(),
    accountId: z.uuid({ error: "Elige la cuenta." }),
    categoryId: z.uuid({ error: "Elige una categoría." }),
    autoRegister: z.boolean(),
  })
  .superRefine((d, ctx) => {
    const needsDate = !["mensual", "quincenal"].includes(d.frequency);
    if (needsDate && !isoDateSchema.safeParse(d.nextDate).success) {
      ctx.addIssue({ code: "custom", path: ["nextDate"], message: "Elige la fecha." });
    }
    if (d.frequency === "mensual" && !dayOfMonth.safeParse(d.day1).success) {
      ctx.addIssue({ code: "custom", path: ["day1"], message: "Elige el día del mes." });
    }
    if (d.frequency === "quincenal") {
      const a = dayOfMonth.safeParse(d.day1);
      const b = dayOfMonth.safeParse(d.day2);
      if (!a.success) ctx.addIssue({ code: "custom", path: ["day1"], message: "Elige el primer día." });
      if (!b.success) ctx.addIssue({ code: "custom", path: ["day2"], message: "Elige el segundo día." });
      if (a.success && b.success && a.data === b.data) {
        ctx.addIssue({ code: "custom", path: ["day2"], message: "Los dos días deben ser diferentes." });
      }
    }
  })
  .transform((d) => ({
    kind: d.kind,
    name: d.name,
    amount: d.amount,
    amountIsEstimate: d.amountIsEstimate,
    frequency: d.frequency,
    nextDate: ["mensual", "quincenal"].includes(d.frequency) ? null : d.nextDate,
    day1: d.frequency === "mensual" || d.frequency === "quincenal" ? Number(d.day1) : null,
    day2: d.frequency === "quincenal" ? Number(d.day2) : null,
    accountId: d.accountId,
    categoryId: d.categoryId,
    autoRegister: d.autoRegister,
  }));
export type ScheduledFormInput = z.infer<typeof scheduledFormSchema>;

export const confirmOccurrenceSchema = z.object({
  itemId: z.uuid(),
  dueDate: isoDateSchema,
  /** Vacío = usar el monto programado. */
  amount: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const r = amountSchema.safeParse(v);
      if (!r.success) {
        ctx.addIssue({ code: "custom", message: r.error.issues[0]?.message ?? "Revisa el monto." });
        return z.NEVER;
      }
      return r.data;
    }),
  accountId: z
    .string()
    .trim()
    .transform((v) => v || null)
    .pipe(z.uuid().nullable()),
});

// ---------------- Presupuesto y preferencias ----------------

export const WARN_PCT_CHOICES = [5, 10, 15, 20, 25] as const;

export const budgetFormSchema = z.object({
  general: amountOrZeroSchema,
  warnPct: z.coerce
    .number()
    .refine((n) => (WARN_PCT_CHOICES as readonly number[]).includes(n), "Elige una opción."),
  byCategory: z.record(z.uuid(), amountOrZeroSchema),
});

export const LETRA_CHOICES = ["normal", "grande", "muy-grande"] as const;
export const TEMA_CHOICES = ["sistema", "claro", "oscuro"] as const;

// ---------------- Tarjetas, compras a meses y préstamos ----------------

const rateSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return 0;
    const bp = parseRatePct(v);
    if (bp == null) {
      ctx.addIssue({ code: "custom", message: "Escribe la tasa como número, por ejemplo 36 o 42.5" });
      return z.NEVER;
    }
    return bp;
  });

const intIn = (min: number, max: number, msg: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: msg });
        return z.NEVER;
      }
      return n;
    });

export const annualFeeSchema = z
  .object({
    hasFee: z.boolean(),
    amount: z.string().trim(),
    nextDate: z.string().trim(),
    withIva: z.boolean(),
  })
  .transform((d, ctx) => {
    if (!d.hasFee) return null;
    const amount = amountSchema.safeParse(d.amount);
    if (!amount.success) ctx.addIssue({ code: "custom", path: ["annualFee"], message: "Escribe el monto de la anualidad." });
    const date = isoDateSchema.safeParse(d.nextDate);
    if (!date.success) ctx.addIssue({ code: "custom", path: ["annualFeeDate"], message: "Elige cuándo te la cobran." });
    if (!amount.success || !date.success) return z.NEVER;
    return { amount: amount.data, nextDate: date.data, withIva: d.withIva };
  });

export const msiFormSchema = z
  .object({
    cardAccountId: z.uuid({ error: "Elige la tarjeta." }),
    description: z.string().trim().min(1, "¿Qué compraste?").max(60, "Muy largo."),
    categoryId: z.uuid({ error: "Elige una categoría." }),
    principal: amountSchema,
    months: intIn(2, 60, "Elige de 2 a 60 meses."),
    withInterest: z.boolean(),
    annualRateBp: rateSchema,
    ivaPct: z.enum(["0", "16"]).transform(Number),
    purchaseDate: isoDateSchema,
    firstDueDate: z.string().trim(),
    alreadyStarted: z.boolean(),
    paidBefore: z.string().trim(),
  })
  .transform((d, ctx) => {
    let paidBefore = 0;
    if (d.alreadyStarted) {
      const n = Number(d.paidBefore);
      if (!Number.isInteger(n) || n < 1 || n >= d.months) {
        ctx.addIssue({ code: "custom", path: ["paidBefore"], message: `Escribe cuántas ya pagaste (de 1 a ${d.months - 1}).` });
        return z.NEVER;
      }
      paidBefore = n;
    }
    if (d.withInterest && d.annualRateBp <= 0) {
      ctx.addIssue({ code: "custom", path: ["annualRateBp"], message: "Escribe la tasa de interés." });
      return z.NEVER;
    }
    const first = d.firstDueDate ? isoDateSchema.safeParse(d.firstDueDate) : null;
    if (first && !first.success) {
      ctx.addIssue({ code: "custom", path: ["firstDueDate"], message: "Revisa la fecha." });
      return z.NEVER;
    }
    return {
      cardAccountId: d.cardAccountId,
      description: d.description,
      categoryId: d.categoryId,
      principal: d.principal,
      months: d.months,
      withInterest: d.withInterest,
      annualRateBp: d.annualRateBp,
      ivaPct: d.ivaPct,
      purchaseDate: d.purchaseDate,
      firstDueDate: first?.data ?? null,
      paidBefore,
    };
  });

export const loanFormSchema = z
  .object({
    name: z.string().trim().min(1, "¿Quién te prestó? Ej. “Banco Azteca” o “Mi hermano”.").max(40),
    informal: z.boolean(),
    principal: amountSchema,
    annualRateBp: rateSchema,
    withIva: z.boolean(),
    periodicity: z.enum(PERIODICITIES, { error: "Elige cada cuándo pagas." }),
    nPayments: intIn(1, 1000, "Escribe cuántos pagos son en total."),
    firstPaymentDate: isoDateSchema,
    openingFee: z.string().trim(),
    catBp: z.string().trim(),
    payFromAccountId: z.uuid({ error: "Elige con qué cuenta pagas." }),
    alreadyStarted: z.boolean(),
    paidBefore: z.string().trim(),
    currentBalance: z.string().trim(),
  })
  .transform((d, ctx) => {
    let paidBefore = 0;
    if (d.alreadyStarted) {
      const n = Number(d.paidBefore);
      if (!Number.isInteger(n) || n < 1 || n >= d.nPayments) {
        ctx.addIssue({ code: "custom", path: ["paidBefore"], message: `Escribe cuántos pagos ya hiciste (de 1 a ${d.nPayments - 1}).` });
        return z.NEVER;
      }
      paidBefore = n;
    }
    const opt = (v: string, path: string) => {
      if (v === "") return null;
      const r = amountSchema.safeParse(v);
      if (!r.success) ctx.addIssue({ code: "custom", path: [path], message: "Revisa el monto." });
      return r.success ? r.data : null;
    };
    const catBp = d.catBp === "" ? null : parseRatePct(d.catBp);
    if (d.catBp !== "" && catBp == null) ctx.addIssue({ code: "custom", path: ["catBp"], message: "Revisa el CAT." });
    return {
      name: d.name,
      informal: d.informal,
      principal: d.principal,
      annualRateBp: d.informal ? 0 : d.annualRateBp,
      ivaPct: d.informal || !d.withIva ? 0 : 16,
      periodicity: d.periodicity,
      nPayments: d.nPayments,
      firstPaymentDate: d.firstPaymentDate,
      openingFee: opt(d.openingFee, "openingFee"),
      catBp,
      payFromAccountId: d.payFromAccountId,
      paidBefore,
      currentBalance: d.alreadyStarted ? opt(d.currentBalance, "currentBalance") : null,
    };
  });

export const prepaySchema = z.object({
  amount: amountSchema,
  date: isoDateSchema,
  fromAccountId: z.uuid({ error: "Elige con qué cuenta pagaste." }),
  mode: z.enum(["plazo", "cuota"], { error: "Elige qué prefieres." }),
});

// ---------------- Apoyos familiares ----------------

export const sendSupportSchema = z.object({
  recipientId: z.uuid({ error: "Elige a quién le mandas el apoyo." }),
  amount: amountSchema,
  date: isoDateSchema,
  fromAccountId: z.uuid({ error: "Elige de qué cuenta sale." }),
  purpose: z.enum(["general", "deuda"], { error: "Elige para qué es." }),
  note: z
    .string()
    .trim()
    .max(120, "La nota es muy larga.")
    .transform((v) => v || null),
  repeat: z.enum(["no", "semanal", "quincenal", "mensual"]).default("no"),
});

export const editSupportSchema = sendSupportSchema.pick({ amount: true, date: true, fromAccountId: true, note: true });

export const receiveSupportSchema = z
  .object({
    accountId: z.uuid({ error: "Elige a qué cuenta te llegó." }),
    apply: z.string().trim(),
  })
  .transform((d, ctx) => {
    // apply: "ninguno" | "tarjeta:<id>" | "cuota:<id>" | "abono:<id>"
    if (d.apply === "" || d.apply === "ninguno") return { accountId: d.accountId, apply: { kind: "ninguno" as const } };
    const [kind, id] = d.apply.split(":");
    const ok = z.uuid().safeParse(id);
    if (!ok.success || !["tarjeta", "cuota", "abono"].includes(kind)) {
      ctx.addIssue({ code: "custom", path: ["apply"], message: "Elige a qué deuda lo aplicas." });
      return z.NEVER;
    }
    const apply =
      kind === "tarjeta"
        ? { kind: "tarjeta" as const, cardId: ok.data }
        : { kind: kind as "cuota" | "abono", loanId: ok.data };
    return { accountId: d.accountId, apply };
  });

// ---------------- Gastos compartidos ----------------

/**
 * Reparto que manda el formulario como JSON en el campo "shared":
 * { mode: "porcentaje" | "monto", parts: [{ userId, value: "50" | "1500" }] }. Vacío = no se comparte.
 */
export const shareSchema = z
  .string()
  .trim()
  .transform((raw, ctx) => {
    if (raw === "") return null;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: "custom", message: "Revisa con quién compartes el gasto." });
      return z.NEVER;
    }
    const parsed = z
      .object({
        mode: z.enum(SPLIT_MODES),
        parts: z.array(z.object({ userId: z.uuid(), value: z.string().max(20) })).min(1, "Elige con quién compartes el gasto.").max(20),
      })
      .safeParse(data);
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: parsed.error.issues[0]?.message ?? "Revisa con quién compartes el gasto." });
      return z.NEVER;
    }
    const parts = [];
    for (const p of parsed.data.parts) {
      const value = parsePartValue(parsed.data.mode, p.value);
      if (value == null) {
        ctx.addIssue({
          code: "custom",
          message: parsed.data.mode === "porcentaje" ? "Escribe el porcentaje de cada persona (del 1 al 100)." : "Escribe cuánto le toca a cada persona.",
        });
        return z.NEVER;
      }
      parts.push({ userId: p.userId, value });
    }
    return { mode: parsed.data.mode, parts };
  });

export const sharedPaySchema = z.object({ fromAccountId: id });
export const sharedReceiveSchema = z.object({ accountId: id });
