import { type Page, expect, test } from "@playwright/test";
import { E2E_USERS } from "./users";

async function loginAs(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(user.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("sin sesión manda a Entrar, con cabeceras de seguridad", async ({ page }) => {
  const response = await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("nonce-");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("contraseña equivocada muestra mensaje amable", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(E2E_USERS.mama.email);
  await page.getByLabel("Contraseña", { exact: true }).fill("no-es-esta-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "no coinciden" })).toBeVisible();
});

test("Mamá entra, ve saludo y navegación grande de 4 opciones", async ({ page }) => {
  const cspErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /Content Security Policy/i.test(msg.text())) cspErrors.push(msg.text());
  });
  await loginAs(page, E2E_USERS.mama);
  await expect(page.getByRole("heading", { name: "Hola, Mamá" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Principal" });
  const links = nav.getByRole("link");
  await expect(links).toHaveCount(4);
  for (const name of ["Inicio", "Registrar", "Mis cuentas", "Más"]) {
    const box = await nav.getByRole("link", { name }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);
  }
  // Letra base de al menos 18px.
  const fontSize = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(18);
  await expectNoHorizontalScroll(page);
  expect(cspErrors).toEqual([]);

  // Mamá no administra: no ve la sección de invitar.
  await page.getByRole("link", { name: "Más" }).click();
  await page.getByRole("link", { name: /Mi familia/ }).click();
  await expect(page.getByRole("heading", { name: "Personas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Invitar a alguien" })).toHaveCount(0);
});

test("el admin invita y la persona crea su cuenta desde el enlace", async ({ page, browser }) => {
  await loginAs(page, E2E_USERS.hijo);
  await page.goto("/mas/familia");
  await page.getByLabel("Nombre de la persona (opcional)").fill("Tía Rosa");
  await page.getByRole("button", { name: "Crear enlace de invitación" }).click();
  const link = await page.locator("p.font-mono").innerText();
  expect(link).toContain("/invitacion/");
  await expect(page.getByRole("link", { name: /WhatsApp/ })).toBeVisible();

  const guest = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const g = await guest.newPage();
  await g.goto(link);
  await expect(g.getByLabel("Tu nombre")).toHaveValue("Tía Rosa");
  await g.getByLabel("Tu correo").fill("rosa@e2e.local");
  await g.getByLabel("Crea una contraseña").fill("frase-de-rosa-123");
  await g.getByLabel("Escríbela otra vez").fill("frase-de-rosa-123");
  await g.getByRole("button", { name: "Crear mi cuenta" }).click();
  await g.waitForURL("/");
  await expect(g.getByRole("heading", { name: "Hola, Tía Rosa" })).toBeVisible();

  // El mismo enlace ya no sirve.
  const g2 = await (await browser.newContext()).newPage();
  await g2.goto(link);
  await expect(g2.getByRole("heading", { name: "Invitación no válida" })).toBeVisible();
  await guest.close();
});

test("cerrar sesión", async ({ page }) => {
  await loginAs(page, E2E_USERS.mama);
  await page.getByRole("link", { name: "Más" }).click();
  await page.getByRole("button", { name: /Cerrar sesión/ }).click();
  await page.waitForURL("/login");
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
