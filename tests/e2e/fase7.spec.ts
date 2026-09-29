import { type Page, expect, test } from "@playwright/test";
import { E2E_USERS } from "./users";

async function loginAs(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(user.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");
}

async function sendSupport(page: Page, amount: string, opts: { debt?: boolean; note?: string } = {}) {
  await page.goto("/registrar");
  await page.getByRole("link", { name: /Apoyo/ }).click();
  await expect(page.getByRole("heading", { name: "Enviar apoyo" })).toBeVisible();
  await page.getByRole("radio", { name: /Mamá/ }).click();
  for (const d of amount) await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: /Siguiente/ }).click();
  if (opts.debt) await page.getByRole("radio", { name: /Para pagar una deuda/ }).click();
  if (opts.note) await page.getByLabel("Nota (opcional)").fill(opts.note);
  await page.getByRole("button", { name: "Enviar apoyo" }).click();
  await expect(page.getByText(/verá el aviso “¿Ya lo recibiste\?”/)).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("el hijo envía un apoyo para una deuda y la mamá lo recibe y lo aplica a su tarjeta", async ({ page, browser }) => {
  await loginAs(page, E2E_USERS.hijo);
  await sendSupport(page, "1500", { debt: true, note: "para tu tarjeta" });
  await expect(page.getByText("⏳ Esperando que confirme que lo recibió")).toBeVisible();

  const mama = await (await browser.newContext({ viewport: { width: 360, height: 800 } })).newPage();
  await loginAs(mama, E2E_USERS.mama);
  const card = mama.getByRole("article", { name: "Apoyo de Daniel" });
  await expect(card).toContainText("te envió $1,500.00 de apoyo para pagar una deuda");
  await expect(card).toContainText("para tu tarjeta");
  await card.getByRole("button", { name: "✅ Sí, ya lo recibí" }).click();
  await card.getByLabel("¿A qué cuenta te llegó?").selectOption({ label: "Banco" });
  await card.getByRole("radio", { name: "Pagar mi tarjeta Tarjeta" }).click();
  await card.getByRole("button", { name: "Confirmar que lo recibí" }).click();
  await expect(mama.getByText("✅ Recibido. ¡Qué bien!")).toBeVisible();

  // El hijo ya lo ve como recibido.
  await page.reload();
  await expect(page.getByText("✅ Recibido", { exact: true })).toBeVisible();
  await expect(page.getByText("Lo usó para pagar su tarjeta.")).toBeVisible();
});

test("'Todavía no' lo esconde; quien envía puede cancelar y deshacer", async ({ page, browser }) => {
  await loginAs(page, E2E_USERS.hijo);
  await sendSupport(page, "300");

  const mama = await (await browser.newContext({ viewport: { width: 360, height: 800 } })).newPage();
  await loginAs(mama, E2E_USERS.mama);
  const card = mama.getByRole("article", { name: "Apoyo de Daniel" }).filter({ hasText: "$300.00" });
  await card.getByRole("button", { name: "⏳ Todavía no" }).click();
  await expect(card).toHaveCount(0);

  // El hijo lo cancela desde su detalle.
  await page.getByRole("button", { name: "✖️ Cancelar apoyo" }).click();
  await page.getByRole("button", { name: "Sí, cancelar" }).click();
  await expect(page.getByText("✖️ Cancelado")).toBeVisible();
  await page.getByRole("button", { name: /Deshacer la cancelación/ }).click();
  await expect(page.getByText("⏳ Esperando que confirme que lo recibió")).toBeVisible();
});

test("historial de apoyos y privacidad: un tercero no ve el apoyo", async ({ page, browser }) => {
  await loginAs(page, E2E_USERS.hijo);
  await page.goto("/apoyos");
  await expect(page.getByRole("link", { name: /Enviaste a Mamá/ }).first()).toBeVisible();
  const url = await page.getByRole("link", { name: /Enviaste a Mamá/ }).first().getAttribute("href");

  // Rosa (misma familia, no participa) no puede abrirlo.
  const rosa = await (await browser.newContext({ viewport: { width: 360, height: 800 } })).newPage();
  await rosa.goto("/login");
  await rosa.getByLabel("Correo").fill("rosa@e2e.local");
  await rosa.getByLabel("Contraseña", { exact: true }).fill("frase-de-rosa-123");
  await rosa.getByRole("button", { name: "Entrar" }).click();
  await rosa.waitForURL("/");
  const res = await rosa.goto(url!);
  expect(res!.status()).toBe(404);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
