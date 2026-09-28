import { z } from "zod";
import { CREATABLE_ACCOUNT_KINDS } from "@/domain/accounts";
import { CATEGORY_KINDS } from "@/domain/categories";
import { parseMoney } from "@/domain/money";
import { FREQUENCIES } from "@/domain/recurrence";

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
