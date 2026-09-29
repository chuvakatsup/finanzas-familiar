import { type Page, expect, test } from "@playwright/test";
import { E2E_CRON_SECRET } from "../../playwright.config";
import { E2E_USERS } from "./users";

async function loginAs(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(user.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");
}

test("ajustes muestra cómo activar recordatorios", async ({ page }) => {
  await loginAs(page, E2E_USERS.mama);
  await page.goto("/mas/ajustes");
  await expect(page.getByRole("heading", { name: /Recordatorios en el celular/ })).toBeVisible();
  // En el navegador de pruebas el service worker puede o no estar listo: debe verse alguna opción clara.
  await expect(page.getByText(/Activar recordatorios|Recordatorios activados|no puede recibir|bloqueadas/)).toBeVisible();
});

test("el envío de recordatorios solo lo puede pedir el servicio cron", async ({ request }) => {
  expect((await request.post("/api/cron/recordatorios")).status()).toBe(401);
  expect((await request.post("/api/cron/recordatorios", { headers: { authorization: "Bearer otro-secreto-que-no-es-0000" } })).status()).toBe(401);
  const ok = await request.post("/api/cron/recordatorios", { headers: { authorization: `Bearer ${E2E_CRON_SECRET}` } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ users: expect.any(Number), sent: expect.any(Number) });
});

test("ayuda, saltar al contenido y páginas no encontradas amables", async ({ page }) => {
  await loginAs(page, E2E_USERS.mama);
  await page.goto("/ayuda");
  await page.getByText("¿Qué significa el semáforo?").click();
  await expect(page.getByText(/con lo que te entra este mes alcanza/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Tener la app en tu pantalla/ })).toBeVisible();

  await page.goto("/ayuda");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();

  await page.goto("/esta-pagina-no-existe");
  await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
});
