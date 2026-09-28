"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { cancelInstallmentPurchase, createInstallmentPurchase } from "@/server/services/msi";
import {
  createLoan,
  payLoanInstallment,
  prepayLoan,
  setLoanArchived,
  undoLastLoanPayment,
} from "@/server/services/loans";
import { loanFormSchema, msiFormSchema, prepaySchema } from "@/lib/schemas/finance";
import { type FormState, fieldErrors } from "@/lib/form-state";
import { field, friendlyError } from "./helpers";

const on = (f: FormData, n: string) => f.get(n) === "on";
const refresh = () => revalidatePath("/", "layout");

// ---------------- Compras a meses ----------------

export async function createMsiAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = msiFormSchema.safeParse({
    cardAccountId: field(formData, "cardAccountId"),
    description: field(formData, "description"),
    categoryId: field(formData, "categoryId"),
    principal: field(formData, "principal"),
    months: field(formData, "months"),
    withInterest: on(formData, "withInterest"),
    annualRateBp: field(formData, "annualRateBp"),
    ivaPct: field(formData, "ivaPct") || "16",
    purchaseDate: field(formData, "purchaseDate"),
    firstDueDate: field(formData, "firstDueDate"),
    alreadyStarted: on(formData, "alreadyStarted"),
    paidBefore: field(formData, "paidBefore"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  let id: string;
  try {
    id = (await getDb().transaction((t) => createInstallmentPurchase(t, actor, parsed.data))).id;
  } catch (e) {
    return friendlyError(e);
  }
  refresh();
  redirect(`/msi/${id}?nueva=1`);
}

export async function cancelMsiAction(formData: FormData) {
  const actor = await requireUser();
  const id = z.uuid().parse(field(formData, "id"));
  const cancelled = field(formData, "cancelled") === "1";
  await getDb().transaction((t) => cancelInstallmentPurchase(t, actor, id, cancelled));
  refresh();
  redirect(`/msi/${id}${cancelled ? "?quitada=1" : ""}`);
}

// ---------------- Préstamos ----------------

export async function createLoanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = loanFormSchema.safeParse({
    name: field(formData, "name"),
    informal: on(formData, "informal"),
    principal: field(formData, "principal"),
    annualRateBp: field(formData, "annualRateBp"),
    withIva: on(formData, "withIva"),
    periodicity: field(formData, "periodicity"),
    nPayments: field(formData, "nPayments"),
    firstPaymentDate: field(formData, "firstPaymentDate"),
    openingFee: field(formData, "openingFee"),
    catBp: field(formData, "catBp"),
    payFromAccountId: field(formData, "payFromAccountId"),
    alreadyStarted: on(formData, "alreadyStarted"),
    paidBefore: field(formData, "paidBefore"),
    currentBalance: field(formData, "currentBalance"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  let id: string;
  try {
    id = (await getDb().transaction((t) => createLoan(t, actor, parsed.data))).id;
  } catch (e) {
    if (e instanceof Error && /nunca se pagaría/.test(e.message)) return { message: e.message };
    return friendlyError(e);
  }
  refresh();
  redirect(`/prestamos/${id}?nuevo=1`);
}

/** "Ya pagué la cuota". */
export async function payLoanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const loanId = z.uuid().safeParse(field(formData, "loanId"));
  const rowId = z.uuid().safeParse(field(formData, "rowId"));
  const from = field(formData, "fromAccountId");
  if (!loanId.success || !rowId.success) return { message: "No encontramos esa cuota." };
  try {
    await getDb().transaction((t) =>
      payLoanInstallment(t, actor, loanId.data, rowId.data, { fromAccountId: from || null }),
    );
    refresh();
    return { data: { done: "pagado" } };
  } catch (e) {
    return friendlyError(e);
  }
}

export async function undoLoanPaymentAction(loanId: string): Promise<FormState> {
  const actor = await requireUser();
  try {
    await getDb().transaction((t) => undoLastLoanPayment(t, actor, z.uuid().parse(loanId)));
    refresh();
    return { data: { done: "deshecho" } };
  } catch (e) {
    return friendlyError(e);
  }
}

export async function prepayLoanAction(loanId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = prepaySchema.safeParse({
    amount: field(formData, "amount"),
    date: field(formData, "date"),
    fromAccountId: field(formData, "fromAccountId"),
    mode: field(formData, "mode"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    await getDb().transaction((t) => prepayLoan(t, actor, z.uuid().parse(loanId), parsed.data));
    refresh();
    return { data: { done: "abono" } };
  } catch (e) {
    return friendlyError(e);
  }
}

export async function archiveLoanAction(formData: FormData) {
  const actor = await requireUser();
  const id = z.uuid().parse(field(formData, "id"));
  const archived = field(formData, "archived") === "1";
  await getDb().transaction((t) => setLoanArchived(t, actor, id, archived));
  refresh();
  redirect(archived ? "/prestamos?quitado=1" : `/prestamos/${id}`);
}
