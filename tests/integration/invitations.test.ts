import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { auditLog, invitations, users } from "@/server/db/schema";
import { AuthzError } from "@/server/authz";
import { validateSession } from "@/server/auth/sessions";
import {
  acceptInvitation,
  createInvitation,
  getInvitation,
  listPendingInvitations,
  revokeInvitation,
} from "@/server/services/invitations";
import { login } from "@/server/services/auth";
import { makeHousehold, resetDb } from "../support/db";

beforeEach(resetDb);
afterAll(closeDb);

const newUser = { name: "Tía Rosa", email: "rosa@test.local", password: "frase-de-rosa-123" };

describe("invitaciones", () => {
  it("el admin invita, la persona crea cuenta en el MISMO grupo y queda con sesión", async () => {
    const { admin, household } = await makeHousehold();
    const inv = await createInvitation(getDb(), admin, { suggestedName: "Rosa" });
    expect(await getInvitation(getDb(), inv.token)).toEqual({
      householdName: household.name,
      suggestedName: "Rosa",
    });

    const r = await getDb().transaction((tx) => acceptInvitation(tx, inv.token, newUser));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const me = await validateSession(getDb(), r.token);
    expect(me).toMatchObject({ householdId: household.id, role: "miembro", email: newUser.email });

    const ok = await login(getDb(), { email: newUser.email, password: newUser.password, ip: "1.1.1.1" });
    expect(ok.ok).toBe(true);

    const audits = await getDb().select().from(auditLog).where(eq(auditLog.entity, "invitation"));
    expect(audits.length).toBeGreaterThan(0);
  });

  it("es de un solo uso", async () => {
    const { admin } = await makeHousehold();
    const inv = await createInvitation(getDb(), admin, {});
    await getDb().transaction((tx) => acceptInvitation(tx, inv.token, newUser));
    const second = await getDb().transaction((tx) =>
      acceptInvitation(tx, inv.token, { ...newUser, email: "otra@test.local" }),
    );
    expect(second).toEqual({ ok: false, error: "invalida" });
    expect(await getInvitation(getDb(), inv.token)).toBeNull();
  });

  it("vencida no sirve", async () => {
    const { admin } = await makeHousehold();
    const inv = await createInvitation(getDb(), admin, {});
    await getDb()
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, inv.id));
    expect(await getInvitation(getDb(), inv.token)).toBeNull();
  });

  it("no deja registrar un correo que ya existe", async () => {
    const { admin } = await makeHousehold();
    const inv = await createInvitation(getDb(), admin, {});
    const r = await getDb().transaction((tx) =>
      acceptInvitation(tx, inv.token, { ...newUser, email: admin.email }),
    );
    expect(r).toEqual({ ok: false, error: "correo-existe" });
    const count = await getDb().select().from(users).where(eq(users.email, admin.email));
    expect(count).toHaveLength(1);
  });

  it("un miembro (no admin) no puede invitar", async () => {
    const { member } = await makeHousehold();
    await expect(createInvitation(getDb(), member, {})).rejects.toBeInstanceOf(AuthzError);
  });

  it("revocada ya no sirve", async () => {
    const { admin } = await makeHousehold();
    const inv = await createInvitation(getDb(), admin, {});
    await revokeInvitation(getDb(), admin, inv.id);
    expect(await getInvitation(getDb(), inv.token)).toBeNull();
    expect(await listPendingInvitations(getDb(), admin)).toHaveLength(0);
  });
});
