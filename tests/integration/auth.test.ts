import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { sessions } from "@/server/db/schema";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { deleteSession, validateSession } from "@/server/auth/sessions";
import { hashToken } from "@/server/auth/tokens";
import { login } from "@/server/services/auth";
import { makeHousehold, resetDb } from "../support/db";

beforeEach(resetDb);
afterAll(closeDb);

const IP = "203.0.113.7";

describe("contraseñas", () => {
  it("usa argon2id y verifica", async () => {
    const h = await hashPassword("una frase larga");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "una frase larga")).toBe(true);
    expect(await verifyPassword(h, "otra cosa")).toBe(false);
    expect(await verifyPassword("basura", "x")).toBe(false);
  });
});

describe("login", () => {
  it("entra con correo (sin importar mayúsculas) y contraseña correctos", async () => {
    const { admin } = await makeHousehold();
    const r = await login(getDb(), { email: ` ${admin.email.toUpperCase()} `, password: "contraseña-segura", ip: IP });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const user = await validateSession(getDb(), r.token);
    expect(user?.id).toBe(admin.id);
    // En BD solo se guarda el hash del token.
    const [row] = await getDb().select().from(sessions).where(eq(sessions.userId, admin.id));
    expect(row.id).toBe(hashToken(r.token));
    expect(row.id).not.toBe(r.token);
  });

  it("mismo mensaje para correo inexistente y contraseña mala", async () => {
    const { admin } = await makeHousehold();
    const a = await login(getDb(), { email: admin.email, password: "mala-mala-mala", ip: IP });
    const b = await login(getDb(), { email: "nadie@test.local", password: "mala-mala-mala", ip: IP });
    expect(a).toEqual({ ok: false, error: "credenciales" });
    expect(b).toEqual({ ok: false, error: "credenciales" });
  });

  it("bloquea tras 5 intentos fallidos, aunque luego ponga la correcta", async () => {
    const { admin } = await makeHousehold();
    for (let i = 0; i < 5; i++) {
      await login(getDb(), { email: admin.email, password: `mala-${i}-xxxxx`, ip: IP });
    }
    const r = await login(getDb(), { email: admin.email, password: "contraseña-segura", ip: IP });
    expect(r).toEqual({ ok: false, error: "bloqueado" });
  });

  it("bloquea por IP tras muchos correos distintos", async () => {
    await makeHousehold();
    for (let i = 0; i < 20; i++) {
      await login(getDb(), { email: `x${i}@test.local`, password: "mala-mala-mala", ip: "198.51.100.1" });
    }
    const { admin } = await makeHousehold();
    const r = await login(getDb(), { email: admin.email, password: "contraseña-segura", ip: "198.51.100.1" });
    expect(r).toEqual({ ok: false, error: "bloqueado" });
  });
});

describe("sesiones", () => {
  it("una sesión vencida no sirve", async () => {
    const { admin } = await makeHousehold();
    const r = await login(getDb(), { email: admin.email, password: "contraseña-segura", ip: IP });
    if (!r.ok) throw new Error("login falló");
    const future = new Date(Date.now() + 61 * 86_400_000);
    expect(await validateSession(getDb(), r.token, future)).toBeNull();
  });

  it("se extiende sola si se usa cerca de vencer", async () => {
    const { admin } = await makeHousehold();
    const r = await login(getDb(), { email: admin.email, password: "contraseña-segura", ip: IP });
    if (!r.ok) throw new Error("login falló");
    const in40days = new Date(Date.now() + 40 * 86_400_000);
    expect(await validateSession(getDb(), r.token, in40days)).not.toBeNull();
    const [row] = await getDb().select().from(sessions).where(eq(sessions.id, hashToken(r.token)));
    expect(row.expiresAt.getTime()).toBeGreaterThan(in40days.getTime() + 59 * 86_400_000);
  });

  it("cerrar sesión la invalida", async () => {
    const { admin } = await makeHousehold();
    const r = await login(getDb(), { email: admin.email, password: "contraseña-segura", ip: IP });
    if (!r.ok) throw new Error("login falló");
    await deleteSession(getDb(), r.token);
    expect(await validateSession(getDb(), r.token)).toBeNull();
  });

  it("token inventado no sirve", async () => {
    expect(await validateSession(getDb(), "inventado")).toBeNull();
  });
});
