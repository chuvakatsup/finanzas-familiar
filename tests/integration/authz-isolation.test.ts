/**
 * Aislamiento entre familias y entre personas: nadie ve ni toca lo de otro grupo.
 * Cada fase nueva agrega aquí sus casos (cuentas, movimientos, apoyos...).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { AuthzError } from "@/server/authz";
import { getHousehold, listMembers } from "@/server/services/household";
import { createInvitation, listPendingInvitations, revokeInvitation } from "@/server/services/invitations";
import { createPasswordResetForMember } from "@/server/services/password-reset";
import { makeHousehold, resetDb } from "../support/db";

beforeEach(resetDb);
afterAll(closeDb);

describe("aislamiento entre familias", () => {
  it("solo se listan miembros del propio grupo", async () => {
    const a = await makeHousehold("A");
    const b = await makeHousehold("B");
    const members = await listMembers(getDb(), a.admin);
    expect(members.map((m) => m.id).sort()).toEqual([a.admin.id, a.member.id].sort());
    expect(members.some((m) => m.id === b.admin.id)).toBe(false);
    expect((await getHousehold(getDb(), a.member))?.id).toBe(a.household.id);
  });

  it("el correo de los demás solo lo ve quien administra", async () => {
    const a = await makeHousehold("A");
    const asMember = await listMembers(getDb(), a.member);
    expect(asMember.every((m) => m.email === undefined)).toBe(true);
    const asAdmin = await listMembers(getDb(), a.admin);
    expect(asAdmin.every((m) => typeof m.email === "string")).toBe(true);
  });

  it("un admin NO puede crear enlace de contraseña para alguien de otra familia", async () => {
    const a = await makeHousehold("A");
    const b = await makeHousehold("B");
    await expect(createPasswordResetForMember(getDb(), a.admin, b.member.id)).rejects.toBeInstanceOf(AuthzError);
  });

  it("un admin NO puede ver ni cancelar invitaciones de otra familia", async () => {
    const a = await makeHousehold("A");
    const b = await makeHousehold("B");
    const invB = await createInvitation(getDb(), b.admin, {});
    expect(await listPendingInvitations(getDb(), a.admin)).toHaveLength(0);
    await expect(revokeInvitation(getDb(), a.admin, invB.id)).rejects.toBeInstanceOf(AuthzError);
    expect(await listPendingInvitations(getDb(), b.admin)).toHaveLength(1);
  });

  it("un actor con householdId falsificado no obtiene datos ajenos por ids", async () => {
    const a = await makeHousehold("A");
    const b = await makeHousehold("B");
    // Aunque alguien forzara el rol admin, sigue atado a su householdId.
    const forged = { ...a.member, role: "admin" as const };
    await expect(createPasswordResetForMember(getDb(), forged, b.admin.id)).rejects.toBeInstanceOf(AuthzError);
  });
});

// ---------------------------------------------------------------------------
// Fase 2: cuentas, categorías y movimientos son SOLO de su dueño
// (ni siquiera alguien de la misma familia puede verlos).
// ---------------------------------------------------------------------------
import { createAccount, getAccount, listAccounts, adjustBalance, setAccountArchived, updateAccount } from "@/server/services/accounts";
import { getOwnedCategory, listCategories, updateCategory } from "@/server/services/categories";
import {
  createExpense,
  createTransfer,
  deleteTransaction,
  getTransaction,
  listTransactions,
  restoreTransaction,
  updateTransaction,
} from "@/server/services/transactions";

async function twoPeopleSameFamily() {
  const fam = await makeHousehold("Misma");
  const mama = fam.member;
  const hijo = fam.admin;
  const [efectivoMama] = await listAccounts(getDb(), mama);
  const [efectivoHijo] = await listAccounts(getDb(), hijo);
  const [catMama] = await listCategories(getDb(), mama, "gasto");
  const [catHijo] = await listCategories(getDb(), hijo, "gasto");
  const txMama = await createExpense(getDb(), mama, {
    amount: 1000, categoryId: catMama.id, accountId: efectivoMama.id, date: "2026-09-01", note: "privado",
  });
  return { mama, hijo, efectivoMama, efectivoHijo, catMama, catHijo, txMama };
}

describe("aislamiento de datos financieros entre personas", () => {
  it("nadie ve las cuentas, categorías ni movimientos de otro (aunque sea admin de la familia)", async () => {
    const s = await twoPeopleSameFamily();
    expect((await listAccounts(getDb(), s.hijo)).some((a) => a.id === s.efectivoMama.id)).toBe(false);
    expect(await listTransactions(getDb(), s.hijo)).toHaveLength(0);
    await expect(getAccount(getDb(), s.hijo, s.efectivoMama.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(getTransaction(getDb(), s.hijo, s.txMama.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(getOwnedCategory(getDb(), s.hijo, s.catMama.id)).rejects.toBeInstanceOf(AuthzError);
    // Filtrar por la cuenta de otro no devuelve nada.
    expect(await listTransactions(getDb(), s.hijo, { accountId: s.efectivoMama.id })).toHaveLength(0);
  });

  it("nadie puede registrar movimientos con cuentas o categorías ajenas", async () => {
    const s = await twoPeopleSameFamily();
    await expect(
      createExpense(getDb(), s.hijo, { amount: 1, categoryId: s.catHijo.id, accountId: s.efectivoMama.id, date: "2026-09-01", note: null }),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(
      createExpense(getDb(), s.hijo, { amount: 1, categoryId: s.catMama.id, accountId: s.efectivoHijo.id, date: "2026-09-01", note: null }),
    ).rejects.toBeInstanceOf(AuthzError);
    // Transferir desde mi cuenta a la de otra persona tampoco (los apoyos son otra cosa).
    await expect(
      createTransfer(getDb(), s.hijo, { amount: 1, fromAccountId: s.efectivoHijo.id, toAccountId: s.efectivoMama.id, date: "2026-09-01", note: null }),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("nadie puede editar, borrar ni restaurar lo de otro", async () => {
    const s = await twoPeopleSameFamily();
    await expect(
      updateTransaction(getDb(), s.hijo, s.txMama.id, { amount: 1, categoryId: s.catHijo.id, accountId: s.efectivoHijo.id, date: "2026-09-01", note: null }),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(deleteTransaction(getDb(), s.hijo, s.txMama.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(restoreTransaction(getDb(), s.hijo, s.txMama.id)).rejects.toBeInstanceOf(AuthzError);
    await expect(
      updateAccount(getDb(), s.hijo, s.efectivoMama.id, { name: "x", last4: null, creditLimit: null, statementDay: null, paymentDueDay: null }),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(setAccountArchived(getDb(), s.hijo, s.efectivoMama.id, true)).rejects.toBeInstanceOf(AuthzError);
    await expect(adjustBalance(getDb(), s.hijo, s.efectivoMama.id, 0)).rejects.toBeInstanceOf(AuthzError);
    await expect(updateCategory(getDb(), s.hijo, s.catMama.id, { name: "x", icon: "📦" })).rejects.toBeInstanceOf(AuthzError);
    // Lo de mamá sigue intacto.
    expect((await getTransaction(getDb(), s.mama, s.txMama.id)).note).toBe("privado");
  });

  it("ids inventados o mal formados responden 'no encontrado' sin romper", async () => {
    const s = await twoPeopleSameFamily();
    await expect(getTransaction(getDb(), s.hijo, "no-es-un-id")).rejects.toBeInstanceOf(AuthzError);
    await expect(getAccount(getDb(), s.hijo, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(AuthzError);
    await expect(
      createAccount(getDb(), s.hijo, { kind: "efectivo", name: "Otra", balance: 0, last4: null, creditLimit: null, statementDay: null, paymentDueDay: null }),
    ).resolves.toBeTruthy();
  });
});
