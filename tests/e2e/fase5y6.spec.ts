import { type Page, expect, test } from "@playwright/test";
import { E2E_USERS } from "./users";

async function loginAs(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(user.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");
}

async function openCard(page: Page) {
  await page.goto("/cuentas");
  await page.getByRole("link", { name: /^Tarjeta / }).click();
}

test.describe.configure({ mode: "serial" });

test("tarjeta: corte, fecha de pago, tasa y anualidad", async ({ page }) => {
  await loginAs(page, E2E_USERS.hijo);
  await openCard(page);
  await page.getByRole("link", { name: /Editar datos/ }).click();
  await page.getByLabel("Día de corte").fill("5");
  await page.getByLabel("Día límite de pago").fill("25");
  await page.getByLabel("Tasa de interés anual (opcional)").fill("48");
  await page.getByLabel("Me cobran anualidad").check();
  await page.getByLabel("¿Cuánto es?").fill("900");
  await page.getByLabel("¿Cuándo te la cobran?").fill("2027-03-15");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tu próximo pago" })).toBeVisible();
  await expect(page.getByText(/Anualidad: \$1,044.00/)).toBeVisible();
});

test("compra a meses que ya iba en el pago 8 de 12", async ({ page }) => {
  await loginAs(page, E2E_USERS.hijo);
  await openCard(page);
  await page.getByRole("link", { name: /Agregar compra a meses/ }).click();
  await page.getByLabel("¿Qué compraste?").fill("Refrigerador");
  await page.getByLabel("Precio total de la compra").fill("12000");
  await page.getByRole("button", { name: "12", exact: true }).click();
  await expect(page.getByText(/Serán 12 pagos de \$1,000.00/)).toBeVisible();
  await page.getByLabel("Ya llevo pagos de esta compra").check();
  await page.getByLabel("¿Cuántas mensualidades ya pagaste?").fill("7");
  await page.getByRole("button", { name: "Guardar compra a meses" }).click();

  await expect(page.getByText("Vas en el pago")).toBeVisible();
  await expect(page.getByText("8 de 12")).toBeVisible();
  await expect(page.getByText(/Te faltan 5 mensualidades/)).toBeVisible();
  await expect(page.getByText("Pagado antes").first()).toBeVisible();

  // La tarjeta refleja solo lo que faltaba ($5,000).
  await openCard(page);
  await expect(page.getByRole("link", { name: /Refrigerador.*\/mes/ })).toContainText("Te faltan 5");
});

test("préstamo informal: tabla, pagar cuota y deshacer", async ({ page }) => {
  await loginAs(page, E2E_USERS.mama);
  await page.goto("/prestamos/nuevo");
  await page.getByLabel("¿Quién te prestó?").fill("Mi hermano");
  await page.getByLabel("Es de familia o amigos, sin intereses").check();
  await page.getByLabel("¿Cuánto te prestaron?").fill("4000");
  await page.getByLabel("¿Cuántos pagos en total?").fill("4");
  await expect(page.getByText(/Cuota de \$1,000.00/)).toBeVisible();
  await page.getByRole("button", { name: "Guardar préstamo" }).click();

  await expect(page.getByText("Préstamo guardado.")).toBeVisible();
  await expect(page.getByText("Pago 1 de 4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "✅ Ya pagué esta cuota" }).click();
  await expect(page.getByText("Pago 2 de 4", { exact: true })).toBeVisible();
  await expect(page.getByText("$3,000.00").first()).toBeVisible();

  await page.getByRole("button", { name: /Deshacer el último pago/ }).click();
  await expect(page.getByText("Pago 1 de 4", { exact: true })).toBeVisible();
});

test("préstamo bancario: abono a capital reduce el plazo y se descarga la tabla", async ({ page }) => {
  await loginAs(page, E2E_USERS.mama);
  await page.goto("/prestamos/nuevo");
  await page.getByLabel("¿Quién te prestó?").fill("Banco Fácil");
  await page.getByLabel("¿Cuánto te prestaron?").fill("100000");
  await page.getByLabel("Tasa de interés anual (%)").fill("24");
  await page.getByLabel("¿Cuántos pagos en total?").fill("12");
  await expect(page.getByText(/Cuota de \$9,642.77/)).toBeVisible();
  await page.getByRole("button", { name: "Guardar préstamo" }).click();
  await expect(page.getByText("Pago 1 de 12", { exact: true })).toBeVisible();

  await page.getByText("Abonar a capital (pago extra)").click();
  await page.getByLabel("¿Cuánto abonaste?").fill("30000");
  await page.getByRole("button", { name: "Registrar abono" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sí, registrar" }).click();
  await expect(page.getByText("Abono registrado. Recalculamos tu tabla.")).toBeVisible();
  await expect(page.getByText("$70,000.00").first()).toBeVisible();
  await expect(page.getByText(/Pago 1 de (8|9|10)$/)).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Descargar/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^tabla-.*\.csv$/);

  // La cuota aparece en próximos pagos y en el balance.
  await page.goto("/proximos?dias=30");
  await expect(page.getByRole("article", { name: /Banco Fácil/ }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
