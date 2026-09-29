import webpush from "web-push";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// Llaves de prueba ANTES de que la app lea el entorno por primera vez.
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;

import { closeDb, getDb } from "@/server/db";
import type { Actor } from "@/server/authz";
import { createAccount } from "@/server/services/accounts";
import { listCategories } from "@/server/services/categories";
import { countSubscriptions, saveSubscription, setPushTransportForTests } from "@/server/services/push";
import { runDailyReminders, notifySupportSent } from "@/server/services/reminders";
import { createScheduled } from "@/server/services/scheduled";
import { sendSupport } from "@/server/services/support";
import { makeHousehold, resetDb } from "../support/db";

const sent: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
let failWith: number | null = null;
setPushTransportForTests(async (sub, payload) => {
  if (failWith) throw Object.assign(new Error("push"), { statusCode: failWith });
  sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
});

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  failWith = null;
});
afterAll(closeDb);

const db = () => getDb();
const none = { last4: null, creditLimit: null, statementDay: null, paymentDueDay: null };
const sub = (n: number) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: "p", auth: "a" } });

async function setup() {
  const fam = await makeHousehold();
  const mama: Actor = fam.member;
  const hijo: Actor = fam.admin;
  const banco = await createAccount(db(), mama, { ...none, kind: "debito", name: "Banco", balance: 100_000 });
  const bancoHijo = await createAccount(db(), hijo, { ...none, kind: "debito", name: "Banco hijo", balance: 100_000 });
  const cats = await listCategories(db(), mama, "gasto");
  await saveSubscription(db(), mama, sub(1), "test");
  return { mama, hijo, banco, bancoHijo, cat: cats[0].id };
}

describe("recordatorios diarios", () => {
  it("avisa de lo que vence mañana, una sola vez por día", async () => {
    const s = await setup();
    await createScheduled(db(), s.mama, {
      kind: "pago", name: "Luz CFE", amount: 45_000, amountIsEstimate: true, frequency: "unica",
      nextDate: "2026-09-29", day1: null, day2: null, accountId: s.banco.id, categoryId: s.cat, autoRegister: false,
    }, "2026-09-28");

    expect(await runDailyReminders(db(), "2026-09-28")).toEqual({ users: 1, sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ title: "Tienes 1 pendiente", url: "/proximos" });
    expect(sent[0].payload.body).toContain("Luz CFE: $450.00 (mañana)");

    // El mismo día no se repite.
    expect((await runDailyReminders(db(), "2026-09-28")).sent).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("sin nada pendiente no molesta", async () => {
    await setup();
    expect((await runDailyReminders(db(), "2026-09-28")).sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("apoyo recibido: aviso inmediato y nunca duplicado por el recordatorio diario", async () => {
    const s = await setup();
    const t = await sendSupport(db(), s.hijo, {
      recipientId: s.mama.id, amount: 150_000, date: "2026-09-28", fromAccountId: s.bancoHijo.id, purpose: "general", note: null,
    });
    await notifySupportSent(db(), t);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.body).toBe("Admin te envió $1,500.00. ¿Ya lo recibiste?");
    await runDailyReminders(db(), "2026-09-28");
    expect(sent.filter((x) => x.payload.title.includes("apoyo"))).toHaveLength(1);
  });

  it("si el celular ya no acepta avisos (410), se borra su suscripción", async () => {
    const s = await setup();
    await createScheduled(db(), s.mama, {
      kind: "pago", name: "Agua", amount: 18_000, amountIsEstimate: false, frequency: "unica",
      nextDate: "2026-09-28", day1: null, day2: null, accountId: s.banco.id, categoryId: s.cat, autoRegister: false,
    }, "2026-09-28");
    failWith = 410;
    await runDailyReminders(db(), "2026-09-28");
    expect(await countSubscriptions(db(), s.mama)).toBe(0);
  });

  it("una suscripción es de una sola persona: si otra la activa en ese celular, pasa a ser suya", async () => {
    const s = await setup();
    await saveSubscription(db(), s.hijo, sub(1), "test");
    expect(await countSubscriptions(db(), s.mama)).toBe(0);
    expect(await countSubscriptions(db(), s.hijo)).toBe(1);
  });
});
