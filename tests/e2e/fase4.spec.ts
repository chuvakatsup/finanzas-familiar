import { type Page, expect, test } from "@playwright/test";
import { E2E_USERS } from "./users";

async function loginAs(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(user.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");
}

test.describe.configure({ mode: "serial" });

test("semáforo en Inicio con una sola cifra y promedio diario; el desglose en 'cuentas del mes'", async ({ page }) => {
  await loginAs(page, E2E_USERS.mama);
  const semaforo = page.getByRole("region", { name: /^Semáforo:/ });
  await expect(semaforo).toBeVisible();
  await expect(page.getByText(/Puedes gastar|Ya no hay margen/)).toBeVisible();
  // Inicio no repite la cifra: el desglose vive en "Las cuentas del mes".
  await expect(page.getByText("Ingresos del mes")).toHaveCount(0);
  const cifra = (await semaforo.locator("p.tabular").textContent())?.trim();

  // El detalle cuadra con la cifra de inicio.
  await page.getByRole("link", { name: /Ver las cuentas del mes/ }).click();
  await expect(page.getByRole("heading", { name: "Las cuentas del mes" })).toBeVisible();
  await expect(page.getByText("Total de ingresos")).toBeVisible();
  await expect(page.getByText("Total de gastos y compromisos")).toBeVisible();
  if (cifra) await expect(page.getByText(/^Te (queda|pasas por) /)).toContainText(cifra);
  await expect(page.getByText("Pagar la tarjeta de crédito no aparece aquí")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("mes siguiente muestra la proyección", async ({ page }) => {
  await loginAs(page, E2E_USERS.mama);
  await page.getByRole("link", { name: /Mes siguiente/ }).click();
  await expect(page.getByRole("region", { name: /Semáforo:/ })).toContainText(/Con lo programado|Aún no hay datos/);
});

test("presupuesto: límite por categoría se ve en '¿A dónde se va mi dinero?'", async ({ page }) => {
  await loginAs(page, E2E_USERS.hijo);
  await page.goto("/mas/presupuesto");
  await page.getByLabel("¿Cuánto quieres gastar al mes en el día a día?").fill("3000");
  await page.getByText("Límites por categoría (opcional)").click();
  await page.getByLabel(/Salud$/).fill("100");
  await page.getByRole("button", { name: "Guardar presupuesto" }).click();
  await expect(page.getByText("Presupuesto guardado.")).toBeVisible();

  await page.goto("/gastos");
  const salud = page.getByRole("link", { name: /Salud/ });
  await expect(salud).toContainText("Te pasaste");
  await page.goto("/");
  await expect(page.getByText(/De tu presupuesto de \$3,000.00 te quedan/)).toBeVisible();
});

test("letra más grande y modo oscuro se aplican al momento", async ({ page }) => {
  await loginAs(page, E2E_USERS.mama);
  await page.goto("/mas/ajustes");
  const before = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await page.getByRole("button", { name: /Muy grande/ }).click();
  await expect(page.getByRole("button", { name: /Muy grande/ })).toHaveAttribute("aria-pressed", "true");
  const after = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  expect(after).toBeGreaterThan(before);
  await page.getByRole("button", { name: /Oscuro/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // Se queda al volver a entrar.
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/letra-muy-grande/);
  // Regresar a normal para las demás pruebas.
  await page.goto("/mas/ajustes");
  await page.getByRole("button", { name: /Normal/ }).click();
  await page.getByRole("button", { name: /Como mi celular/ }).click();
});

test("asistente de primer uso: persona nueva sin datos", async ({ page, browser }) => {
  // Invitar a alguien nuevo desde la cuenta de admin.
  await loginAs(page, E2E_USERS.hijo);
  await page.goto("/mas/familia");
  await page.getByRole("button", { name: "Crear enlace de invitación" }).click();
  const link = await page.locator("p.font-mono").innerText();

  const g = await (await browser.newContext({ viewport: { width: 360, height: 800 } })).newPage();
  await g.goto(link);
  await g.getByLabel("Tu nombre").fill("Abuelo");
  await g.getByLabel("Tu correo").fill("abuelo@e2e.local");
  await g.getByLabel("Crea una contraseña").fill("frase-del-abuelo-1");
  await g.getByLabel("Escríbela otra vez").fill("frase-del-abuelo-1");
  await g.getByRole("button", { name: "Crear mi cuenta" }).click();
  await g.waitForURL("/");

  await g.getByRole("link", { name: "Empezar" }).click();
  // Paso 1
  await g.getByLabel("¿Cuánto efectivo tienes hoy?").fill("500");
  await g.getByLabel("Tengo cuenta de banco o tarjeta de débito").check();
  await g.getByLabel("Nombre del banco").fill("Bancomer");
  await g.getByLabel("¿Cuánto tienes ahí?").fill("3000");
  await g.getByRole("button", { name: "Siguiente →" }).click();
  // Paso 2
  await expect(g.getByRole("heading", { name: "¿Cuánto te llega?" })).toBeVisible();
  await g.getByRole("button", { name: "Cada mes" }).click();
  await g.getByLabel("¿Cuánto te llega cada vez?").fill("8000");
  await g.getByRole("button", { name: "Siguiente →" }).click();
  // Paso 3
  await expect(g.getByRole("heading", { name: "¿Qué pagas cada mes?" })).toBeVisible();
  await g.getByLabel("Agua").check();
  await g.getByLabel("Más o menos").fill("200");
  await g.getByRole("button", { name: "Terminar", exact: true }).click();
  await g.getByRole("button", { name: "Ver mi semáforo" }).click();

  await g.waitForURL("/");
  await expect(g.getByRole("region", { name: /^Semáforo:/ })).toBeVisible();
  await expect(g.getByRole("link", { name: "Empezar" })).toHaveCount(0);
  await g.getByRole("link", { name: /Ver las cuentas del mes/ }).click();
  await expect(g.getByText("Total de ingresos").locator("..")).toContainText("$8,000.00");
});
