import { type Page, expect, test } from "@playwright/test";
import { E2E_USERS } from "./users";

async function loginAs(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(user.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");
}

async function bancoBalance(page: Page) {
  await page.goto("/cuentas");
  return (await page.getByRole("link", { name: /^Banco / }).innerText()).replace(/\s+/g, " ");
}

/** Crea un programado de "una sola vez" para HOY (fecha determinista en la prueba). */
async function addOneTime(
  page: Page,
  kind: "pago" | "ingreso",
  name: string,
  amount: string,
  opts: { estimate?: boolean; auto?: boolean } = {},
) {
  await page.goto(kind === "pago" ? "/pagos-fijos/nuevo" : "/ingresos-fijos/nuevo");
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel(kind === "pago" ? "¿Cuánto pagas?" : "¿Cuánto recibes?").fill(amount);
  if (opts.estimate) await page.getByLabel("El monto cambia cada vez (es aproximado)").check();
  await page.getByRole("radio", { name: "Una sola vez" }).click();
  await page.getByLabel(kind === "pago" ? "¿Con qué se paga?" : "¿A qué cuenta llega?").selectOption({ label: "Banco" });
  if (opts.auto) await page.getByLabel(/Se cobra solo|Me lo depositan/).check();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Guardado.")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("pago fijo: aparece en Inicio como 'Hoy', se confirma con un toque y se puede deshacer", async ({ page }) => {
  await loginAs(page, E2E_USERS.mama);
  await addOneTime(page, "pago", "Agua potable", "180");
  await expect(page.getByRole("link", { name: /Agua potable/ })).toContainText("Próximo: Hoy");

  await page.goto("/");
  const card = page.getByRole("article", { name: /Agua potable/ });
  await expect(card).toContainText("Hoy");
  await card.getByRole("button", { name: "✅ Ya lo pagué" }).click();
  await expect(card.getByText("Pagado")).toBeVisible();
  expect(await bancoBalance(page)).toContain("$4,820.00");

  await page.goto("/");
  await page.getByRole("article", { name: /Agua potable/ }).getByRole("button", { name: /Deshacer/ }).click();
  await expect(page.getByRole("article", { name: /Agua potable/ }).getByRole("button", { name: "✅ Ya lo pagué" })).toBeVisible();
  expect(await bancoBalance(page)).toContain("$5,000.00");
});

test("monto aproximado: se escribe el monto real al confirmar", async ({ page }) => {
  await loginAs(page, E2E_USERS.mama);
  await addOneTime(page, "pago", "Luz CFE", "450", { estimate: true });
  await page.goto("/proximos");
  const card = page.getByRole("article", { name: /Luz CFE/ });
  await expect(card).toContainText("aprox.");
  await card.getByLabel("¿Cuánto pagaste?").fill("512.30");
  await card.getByRole("button", { name: "✅ Ya lo pagué" }).click();
  await expect(card.getByText("Pagado")).toBeVisible();
  await expect(card).toContainText("$512.30");
  expect(await bancoBalance(page)).toContain("$4,487.70");
});

test("ingreso fijo: 'Ya me pagaron' y 'No aplica esta vez'", async ({ page }) => {
  await loginAs(page, E2E_USERS.mama);
  await addOneTime(page, "ingreso", "Renta del cuarto", "2000");
  await page.goto("/proximos");
  const card = page.getByRole("article", { name: /Renta del cuarto/ });
  await card.getByRole("button", { name: "No aplica esta vez" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sí, saltar" }).click();
  await expect(card.getByText("Saltado esta vez")).toBeVisible();
  expect(await bancoBalance(page)).toContain("$4,487.70");

  await page.goto("/proximos");
  await page.getByRole("article", { name: /Renta del cuarto/ }).getByRole("button", { name: /Deshacer/ }).click();
  await page.getByRole("article", { name: /Renta del cuarto/ }).getByRole("button", { name: "✅ Ya me pagaron" }).click();
  await expect(page.getByRole("article", { name: /Renta del cuarto/ }).getByText("Recibido")).toBeVisible();
  expect(await bancoBalance(page)).toContain("$6,487.70");
});

test("domiciliado: se anota solo cuando llega la fecha", async ({ page }) => {
  await loginAs(page, E2E_USERS.mama);
  await addOneTime(page, "pago", "Netflix", "299", { auto: true });
  await page.goto("/");
  const card = page.getByRole("article", { name: /Netflix/ });
  await expect(card.getByText("Pagado")).toBeVisible();
  await expect(card).toContainText("automático");
  expect(await bancoBalance(page)).toContain("$6,188.70");
});

test("ingreso quincenal con 15 y último, y quitar un pago fijo", async ({ page }) => {
  await loginAs(page, E2E_USERS.mama);
  await page.goto("/ingresos-fijos/nuevo");
  await page.getByLabel("Nombre").fill("Pensión IMSS");
  await page.getByLabel("¿Cuánto recibes?").fill("6500");
  // Quincenal viene elegido por defecto con 15 y último.
  await expect(page.getByRole("radio", { name: "Cada quincena" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Primer día")).toHaveValue("15");
  await expect(page.getByLabel("Segundo día")).toHaveValue("31");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("link", { name: /Pensión IMSS/ })).toContainText("Cada quincena: 15 y último");

  await page.goto("/pagos-fijos");
  await page.getByRole("link", { name: /Agua potable/ }).click();
  await page.getByRole("button", { name: /Quitar/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sí, quitar" }).click();
  await expect(page.getByText("Se quitó")).toBeVisible();
  await expect(page.getByRole("link", { name: /Agua potable/ })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
