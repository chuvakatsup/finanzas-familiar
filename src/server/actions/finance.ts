"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import {
  adjustBalance,
  createAccount,
  setAccountArchived,
  updateAccount,
} from "@/server/services/accounts";
import { createCategory, setCategoryArchived, updateCategory } from "@/server/services/categories";
import { setAnnualFee } from "@/server/services/cards";
import {
  createExpense,
  createIncome,
  createTransfer,
  deleteTransaction,
  restoreTransaction,
  updateTransaction,
} from "@/server/services/transactions";
import {
  accountEditSchema,
  accountFormSchema,
  annualFeeSchema,
  adjustBalanceSchema,
  categoryFormSchema,
  expenseSchema,
  incomeSchema,
  transferSchema,
} from "@/lib/schemas/finance";
import { type FormState, fieldErrors } from "@/lib/form-state";
import { field, friendlyError } from "./helpers";

function parseAnnualFee(formData: FormData) {
  return annualFeeSchema.safeParse({
    hasFee: formData.get("hasAnnualFee") === "on",
    amount: field(formData, "annualFee"),
    nextDate: field(formData, "annualFeeDate"),
    withIva: formData.get("annualFeeIva") === "on",
  });
}

function refreshMoneyPages() {
  revalidatePath("/", "layout");
}

const idSchema = z.uuid();

// ---------------- Movimientos ----------------

export async function createExpenseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = expenseSchema.safeParse({
    amount: field(formData, "amount"),
    categoryId: field(formData, "categoryId"),
    accountId: field(formData, "accountId"),
    date: field(formData, "date"),
    note: field(formData, "note"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    const tx = await getDb().transaction((t) => createExpense(t, actor, parsed.data));
    refreshMoneyPages();
    return { data: { id: tx.id } };
  } catch (e) {
    return friendlyError(e);
  }
}

export async function createIncomeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = incomeSchema.safeParse({
    amount: field(formData, "amount"),
    categoryId: field(formData, "categoryId"),
    accountId: field(formData, "accountId"),
    date: field(formData, "date"),
    note: field(formData, "note"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    const tx = await getDb().transaction((t) => createIncome(t, actor, parsed.data));
    refreshMoneyPages();
    return { data: { id: tx.id } };
  } catch (e) {
    return friendlyError(e);
  }
}

export async function createTransferAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = transferSchema.safeParse({
    amount: field(formData, "amount"),
    fromAccountId: field(formData, "fromAccountId"),
    toAccountId: field(formData, "toAccountId"),
    date: field(formData, "date"),
    note: field(formData, "note"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    const tx = await getDb().transaction((t) => createTransfer(t, actor, parsed.data));
    refreshMoneyPages();
    return { data: { id: tx.id, kind: tx.kind } };
  } catch (e) {
    return friendlyError(e);
  }
}

export async function updateTransactionAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const isTransfer = formData.has("fromAccountId");
  const parsed = isTransfer
    ? transferSchema.safeParse({
        amount: field(formData, "amount"),
        fromAccountId: field(formData, "fromAccountId"),
        toAccountId: field(formData, "toAccountId"),
        date: field(formData, "date"),
        note: field(formData, "note"),
      })
    : expenseSchema.safeParse({
        amount: field(formData, "amount"),
        categoryId: field(formData, "categoryId"),
        accountId: field(formData, "accountId"),
        date: field(formData, "date"),
        note: field(formData, "note"),
      });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    await getDb().transaction((t) => updateTransaction(t, actor, idSchema.parse(id), parsed.data));
    refreshMoneyPages();
    return { data: { saved: "1" } };
  } catch (e) {
    return friendlyError(e);
  }
}

/** Deshacer justo después de guardar (borrado suave). */
export async function undoTransactionAction(id: string): Promise<FormState> {
  const actor = await requireUser();
  try {
    await getDb().transaction((t) => deleteTransaction(t, actor, idSchema.parse(id)));
    refreshMoneyPages();
    return { data: { undone: "1" } };
  } catch (e) {
    return friendlyError(e);
  }
}

/** Borrar desde el detalle: vuelve al historial con opción de Deshacer. */
export async function deleteTransactionAction(formData: FormData) {
  const actor = await requireUser();
  const id = idSchema.parse(field(formData, "id"));
  await getDb().transaction((t) => deleteTransaction(t, actor, id));
  refreshMoneyPages();
  const back = field(formData, "back");
  const target = back.startsWith("/movimientos") ? back : "/movimientos";
  redirect(`${target}${target.includes("?") ? "&" : "?"}borrado=${id}`);
}

export async function restoreTransactionAction(formData: FormData) {
  const actor = await requireUser();
  const id = idSchema.parse(field(formData, "id"));
  await getDb().transaction((t) => restoreTransaction(t, actor, id));
  refreshMoneyPages();
  redirect(`/movimientos/${id}?restaurado=1`);
}

// ---------------- Cuentas ----------------

export async function createAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = accountFormSchema.safeParse({
    kind: field(formData, "kind"),
    name: field(formData, "name"),
    balance: field(formData, "balance"),
    last4: field(formData, "last4"),
    creditLimit: field(formData, "creditLimit"),
    statementDay: field(formData, "statementDay"),
    paymentDueDay: field(formData, "paymentDueDay"),
    interestRateBp: field(formData, "interestRateBp"),
  });
  const fee = parseAnnualFee(formData);
  if (!parsed.success || !fee.success) {
    return { fieldErrors: { ...(parsed.success ? {} : fieldErrors(parsed.error)), ...(fee.success ? {} : fieldErrors(fee.error)) } };
  }
  let id: string;
  try {
    const account = await getDb().transaction(async (t) => {
      const created = await createAccount(t, actor, parsed.data);
      if (created.kind === "credito" && fee.data) await setAnnualFee(t, actor, created.id, fee.data);
      return created;
    });
    id = account.id;
  } catch (e) {
    return friendlyError(e);
  }
  refreshMoneyPages();
  redirect(`/cuentas/${id}?nueva=1`);
}

export async function updateAccountAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = accountEditSchema.safeParse({
    name: field(formData, "name"),
    last4: field(formData, "last4"),
    creditLimit: field(formData, "creditLimit"),
    statementDay: field(formData, "statementDay"),
    paymentDueDay: field(formData, "paymentDueDay"),
    interestRateBp: field(formData, "interestRateBp"),
  });
  const fee = parseAnnualFee(formData);
  if (!parsed.success || !fee.success) {
    return { fieldErrors: { ...(parsed.success ? {} : fieldErrors(parsed.error)), ...(fee.success ? {} : fieldErrors(fee.error)) } };
  }
  try {
    await getDb().transaction(async (t) => {
      const updated = await updateAccount(t, actor, idSchema.parse(id), parsed.data);
      if (updated.kind === "credito") await setAnnualFee(t, actor, updated.id, fee.data);
    });
  } catch (e) {
    return friendlyError(e);
  }
  refreshMoneyPages();
  redirect(`/cuentas/${id}?guardado=1`);
}

export async function adjustBalanceAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = adjustBalanceSchema.safeParse({ realBalance: field(formData, "realBalance") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    await getDb().transaction((t) => adjustBalance(t, actor, idSchema.parse(id), parsed.data.realBalance));
  } catch (e) {
    return friendlyError(e);
  }
  refreshMoneyPages();
  redirect(`/cuentas/${id}?corregido=1`);
}

export async function setAccountArchivedAction(formData: FormData) {
  const actor = await requireUser();
  const id = idSchema.parse(field(formData, "id"));
  const archived = field(formData, "archived") === "1";
  await getDb().transaction((t) => setAccountArchived(t, actor, id, archived));
  refreshMoneyPages();
  redirect(archived ? `/cuentas?archivada=${id}` : `/cuentas/${id}`);
}

// ---------------- Categorías ----------------

export async function createCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = categoryFormSchema.safeParse({
    kind: field(formData, "kind"),
    name: field(formData, "name"),
    icon: field(formData, "icon"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    await getDb().transaction((t) => createCategory(t, actor, parsed.data));
    refreshMoneyPages();
    return { data: { saved: parsed.data.name } };
  } catch (e) {
    return friendlyError(e);
  }
}

export async function updateCategoryAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = categoryFormSchema.omit({ kind: true }).safeParse({
    name: field(formData, "name"),
    icon: field(formData, "icon"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    await getDb().transaction((t) => updateCategory(t, actor, idSchema.parse(id), parsed.data));
    refreshMoneyPages();
    return { data: { saved: parsed.data.name } };
  } catch (e) {
    return friendlyError(e);
  }
}

export async function setCategoryArchivedAction(
  id: string,
  archived: boolean,
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  try {
    await getDb().transaction((t) => setCategoryArchived(t, actor, idSchema.parse(id), archived));
    refreshMoneyPages();
    return {};
  } catch (e) {
    return friendlyError(e);
  }
}
