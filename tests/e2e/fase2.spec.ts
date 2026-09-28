import { type Page, expect, test } from "@playwright/test";
import { E2E_USERS } from "./users";

async function loginAs(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(user.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");
}

async function typeAmount(page: Page, digits: string) {
  for (const d of digits) {
    await page.getByRole("button", { name: d === "." ? "Punto decimal" : d, exact: true }).click();
  }
}

async function balanceOf(page: Page, name: string) {
  await page.goto("/cuentas");
  const card = page.getByRole("link", { name: new RegExp(`^${name} `) });
  return (await card.innerText()).replace(/\s+/g, " ");
}

test.describe.configure({ mode: "serial" });

test("registrar un gasto: monto → categoría → Guardar (cuenta ya elegida), y deshacer", async ({ page }) => {
  await loginAs(page, E2E_USERS.hijo);
  await page.getByRole("link", { name: "Registrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "¿Cuánto gastaste?" })).toBeVisible();

  await typeAmount(page, "150.5");
  await page.getByRole("button", { name: /Siguiente/ }).click(); // toque 1
  await page.getByRole("radio", { name: /Comida/ }).click(); // toque 2
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(1); // una cuenta ya elegida
  await page.getByRole("radio", { name: /Efectivo/ }).click();
  await page.getByRole("button", { name: "Guardar gasto" }).click(); // toque 3

  await expect(page.getByText("Gasto guardado")).toBeVisible();
  await expect(page.getByText("$150.50")).toBeVisible();
  expect(await balanceOf(page, "Efectivo")).toContain("$849.50");

  // Deshacer inmediatamente
  await page.goBack();
  await page.goto("/registrar");
  await typeAmount(page, "20");
  await page.getByRole("button", { name: /Siguiente/ }).click();
  await page.getByRole("radio", { name: /Transporte/ }).click();
  // Ahora propone la última cuenta usada (Efectivo).
  await expect(page.getByRole("radio", { name: /Efectivo/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Guardar gasto" }).click();
  await page.getByRole("button", { name: /Deshacer/ }).click();
  await expect(page.getByText("se deshizo")).toBeVisible();
  expect(await balanceOf(page, "Efectivo")).toContain("$849.50");
});

test("pagar la tarjeta no cuenta como gasto y baja la deuda", async ({ page }) => {
  await loginAs(page, E2E_USERS.hijo);
  // Compra con tarjeta
  await page.goto("/registrar");
  await typeAmount(page, "300");
  await page.getByRole("button", { name: /Siguiente/ }).click();
  await page.getByRole("radio", { name: /Salud/ }).click();
  await page.getByRole("radio", { name: /Tarjeta/ }).click();
  await page.getByRole("button", { name: "Guardar gasto" }).click();
  await expect(page.getByText("Gasto guardado")).toBeVisible();
  expect(await balanceOf(page, "Tarjeta")).toContain("$300.00");

  // Pago desde el banco
  await page.goto("/registrar/transferencia");
  await typeAmount(page, "300");
  await page.getByRole("button", { name: /Siguiente/ }).click();
  await page.getByRole("radiogroup", { name: "De dónde sale" }).getByRole("radio", { name: /Banco/ }).click();
  await page.getByRole("radiogroup", { name: "A dónde va" }).getByRole("radio", { name: /Tarjeta/ }).click();
  await expect(page.getByText("no cuenta como gasto nuevo")).toBeVisible();
  await page.getByRole("button", { name: "Guardar pago de tarjeta" }).click();
  await expect(page.getByText("Pago de tarjeta guardado")).toBeVisible();

  expect(await balanceOf(page, "Tarjeta")).toContain("$0.00");
  expect(await balanceOf(page, "Banco")).toContain("$4,700.00");

  // En el mes solo se gastó 150.50 + 300 (el pago no suma).
  await page.goto("/movimientos");
  await expect(page.getByText("Gastaste").locator("..")).toContainText("$450.50");
});

test("historial: buscar, borrar con confirmación y deshacer", async ({ page }) => {
  await loginAs(page, E2E_USERS.hijo);
  await page.goto("/movimientos");
  await page.getByText("Buscar y filtrar").click();
  await page.getByLabel("Buscar").fill("comida");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  const row = page.getByRole("link", { name: /Comida/ }).first();
  await expect(row).toContainText("$150.50");
  await row.click();

  await page.getByRole("button", { name: /Borrar movimiento/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("¿Borrar este movimiento?");
  await dialog.getByRole("button", { name: "Sí, borrar" }).click();

  await expect(page.getByText("Se borró el movimiento.")).toBeVisible();
  expect(await balanceOf(page, "Efectivo")).toContain("$1,000.00");
  await page.goBack();
  await page.getByRole("button", { name: /Deshacer/ }).click();
  await expect(page.getByText("se recuperó")).toBeVisible();
  expect(await balanceOf(page, "Efectivo")).toContain("$849.50");
});

test("agregar tarjeta de crédito con deuda y corregir saldo", async ({ page }) => {
  await loginAs(page, E2E_USERS.mama);
  await page.goto("/cuentas/nueva");
  await page.getByRole("radio", { name: /Tarjeta de crédito/ }).click();
  await page.getByLabel("Nombre").fill("Liverpool");
  await page.getByLabel("¿Cuánto debes hoy en esta tarjeta?").fill("1,250.75");
  await page.getByLabel("Límite de crédito (opcional)").fill("10000");
  await page.getByLabel("Día de corte").fill("5");
  await page.getByLabel("Día límite de pago").fill("25");
  await page.getByLabel("Últimos 4 números (opcional)").fill("4821");
  await page.getByRole("button", { name: "Agregar" }).click();
  await expect(page.getByRole("heading", { name: "Liverpool" })).toBeVisible();
  await expect(page.getByText("$1,250.75").first()).toBeVisible();
  await expect(page.getByText("$8,749.25")).toBeVisible();
  await expect(page.getByText("Pagar antes del día 25")).toBeVisible();

  await page.getByRole("link", { name: /Corregir lo que debo/ }).click();
  await page.getByLabel("¿Cuánto debes de verdad?").fill("1300");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Saldo corregido.")).toBeVisible();
  await expect(page.getByText("$1,300.00").first()).toBeVisible();

  // Sin scroll horizontal a 360px
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("errores amables: número de tarjeta completo no se acepta", async ({ page }) => {
  await loginAs(page, E2E_USERS.mama);
  await page.goto("/cuentas/nueva");
  await page.getByRole("radio", { name: /Tarjeta de débito/ }).click();
  await page.getByLabel("Nombre").fill("Banco X");
  await page.getByLabel("Últimos 4 números (opcional)").fill("12");
  await page.getByRole("button", { name: "Agregar" }).click();
  await expect(page.getByText("Solo los últimos 4 números")).toBeVisible();
});

test("descargar mis datos en CSV", async ({ page }) => {
  await loginAs(page, E2E_USERS.hijo);
  await page.goto("/mas");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /Descargar mis datos/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^mis-movimientos-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  expect(text).toContain("Fecha,Tipo,Monto,Categoría");
  expect(text).toContain("-150.50");
  expect(text).toContain("Pago de tarjeta");
});

test("el CSV no se descarga sin sesión", async ({ request }) => {
  const r = await request.get("/api/export/movimientos");
  expect(r.status()).toBe(401);
});
