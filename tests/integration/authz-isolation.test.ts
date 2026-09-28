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
