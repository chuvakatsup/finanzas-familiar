import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { AuthzError } from "@/server/authz";
import { validateSession } from "@/server/auth/sessions";
import { login } from "@/server/services/auth";
import { createHouseholdWithAdmin } from "@/server/services/household";
import {
  completePasswordReset,
  createPasswordResetForMember,
  getPasswordReset,
} from "@/server/services/password-reset";
import { makeHousehold, resetDb } from "../support/db";

beforeEach(resetDb);
afterAll(closeDb);

const IP = "192.0.2.10";

describe("restablecer contraseña (lo hace el admin)", () => {
  it("el admin genera enlace; el miembro pone contraseña nueva y se cierran sus sesiones viejas", async () => {
    const { admin, member } = await makeHousehold();
    const old = await login(getDb(), { email: member.email, password: "contraseña-segura", ip: IP });
    if (!old.ok) throw new Error("login falló");

    const reset = await createPasswordResetForMember(getDb(), admin, member.id);
    expect(await getPasswordReset(getDb(), reset.token)).toMatchObject({ email: member.email, firstTime: false });

    const session = await getDb().transaction((tx) =>
      completePasswordReset(tx, reset.token, "nueva-contraseña-123"),
    );
    expect(session).not.toBeNull();
    expect(await validateSession(getDb(), old.token)).toBeNull();

    expect((await login(getDb(), { email: member.email, password: "contraseña-segura", ip: IP })).ok).toBe(false);
    expect((await login(getDb(), { email: member.email, password: "nueva-contraseña-123", ip: IP })).ok).toBe(true);
  });

  it("el enlace es de un solo uso y un enlace nuevo invalida el anterior", async () => {
    const { admin, member } = await makeHousehold();
    const first = await createPasswordResetForMember(getDb(), admin, member.id);
    const second = await createPasswordResetForMember(getDb(), admin, member.id);
    expect(await getPasswordReset(getDb(), first.token)).toBeNull();
    await completePasswordReset(getDb(), second.token, "nueva-contraseña-123");
    expect(await completePasswordReset(getDb(), second.token, "otra-contraseña-456")).toBeNull();
  });

  it("un miembro no puede generar enlaces", async () => {
    const { admin, member } = await makeHousehold();
    await expect(createPasswordResetForMember(getDb(), member, admin.id)).rejects.toBeInstanceOf(AuthzError);
  });

  it("alta por CLI: admin sin contraseña recibe enlace de primera vez", async () => {
    const r = await getDb().transaction((tx) =>
      createHouseholdWithAdmin(tx, { householdName: "Familia CLI", adminName: "Dani", adminEmail: "Dani@Test.local" }),
    );
    expect(r.admin.email).toBe("dani@test.local");
    // Sin contraseña no puede entrar.
    expect((await login(getDb(), { email: "dani@test.local", password: "lo-que-sea-123", ip: IP })).ok).toBe(false);
    expect(await getPasswordReset(getDb(), r.resetToken)).toMatchObject({ firstTime: true });
    await completePasswordReset(getDb(), r.resetToken, "mi-primera-contraseña");
    expect((await login(getDb(), { email: "dani@test.local", password: "mi-primera-contraseña", ip: IP })).ok).toBe(true);
  });
});
