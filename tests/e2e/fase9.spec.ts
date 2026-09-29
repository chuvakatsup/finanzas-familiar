import { type Page, expect, test } from "@playwright/test";
import { E2E_USERS } from "./users";

async function loginAs(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(user.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");
}

async function typeAmount(page: Page, amount: string) {
  for (const d of amount) await page.getByRole("button", { name: d === "." ? "Punto decimal" : d, exact: true }).click();
}

/** Deuda de la tarjeta "Tarjeta" en centavos (como la muestra "Mis cuentas"). */
async function cardDebt(page: Page) {
  await page.goto("/cuentas");
  const text = await page.getByRole("link", { name: /^Tarjeta / }).innerText();
  const m = text.match(/\$([\d,]+)\.(\d{2})/);
  return m ? Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]) : NaN;
}

test.describe.configure({ mode: "serial" });

test("gasto con tarjeta compartido 50%: mamá paga su parte y el hijo la aplica directo a la tarjeta", async ({ page, browser }) => {
  await loginAs(page, E2E_USERS.hijo);
  const debtBefore = await cardDebt(page);
  await page.goto("/registrar");
  await typeAmount(page, "1000");
  await page.getByRole("button", { name: /Siguiente/ }).click();
  await page.getByRole("radio", { name: /Salud/ }).click();
  await page.getByRole("radio", { name: /Tarjeta/ }).click();

  await page.getByRole("button", { name: /Es compartido con tu familia/ }).click();
  await page.getByRole("checkbox", { name: "Mamá" }).check();
  // Propone partes iguales: 50% para cada quien.
  await expect(page.getByLabel("¿Qué porcentaje le toca a Mamá?")).toHaveValue("50");
  const resumen = page.getByRole("status").filter({ hasText: "Tu parte" });
  await expect(resumen).toContainText("Mamá te debe$500.00");
  await expect(resumen).toContainText("Tu parte$500.00");
  await page.getByRole("button", { name: "Guardar gasto" }).click();
  await expect(page.getByText("Mamá te debe $500.00")).toBeVisible();

  // Mamá lo ve en Inicio y paga su parte.
  const mama = await (await browser.newContext({ viewport: { width: 360, height: 800 } })).newPage();
  await loginAs(mama, E2E_USERS.mama);
  const card = mama.getByRole("article", { name: "Gasto compartido: Salud" });
  await expect(card).toContainText("Daniel pagó Salud. Te toca $500.00 (50%).");
  await card.getByRole("button", { name: "✅ Ya te pagué" }).click();
  await card.getByLabel("¿De qué cuenta salió?").selectOption({ label: "Banco" });
  await card.getByRole("button", { name: "Confirmar que le pagué $500.00" }).click();
  await expect(card).toContainText("✅ Pagado. Le avisamos a Daniel.");

  // El hijo confirma que le llegó, directo a su tarjeta.
  await page.goto("/");
  const own = page.getByRole("article", { name: "Gasto compartido: Salud" });
  await expect(own).toContainText("Mamá dice que ya te pagó $500.00 de Salud. ¿Te llegó?");
  await expect(own.getByLabel("¿A dónde te llegó?")).toHaveValue(/.+/);
  await expect(own.getByLabel("¿A dónde te llegó?").locator("option:checked")).toHaveText("Directo a mi tarjeta Tarjeta");
  await own.getByRole("button", { name: "✅ Sí, me llegó" }).click();
  await expect(own).toContainText("✅ Recibido. ¡Listo!");

  // La tarjeta sube solo la mitad: $1,000 de cargo − $500 que pagó mamá.
  expect((await cardDebt(page)) - debtBefore).toBe(50_000);

  await page.goto("/compartidos");
  await expect(page.getByRole("heading", { name: "Ya saldados" })).toBeVisible();
  await expect(page.getByText("✅ Pagado")).toBeVisible();
});

test("compartir un gasto ya registrado, por cantidad; 'Esto no es mío' le avisa al hijo", async ({ page, browser }) => {
  await loginAs(page, E2E_USERS.hijo);
  await page.goto("/registrar");
  await typeAmount(page, "300");
  await page.getByRole("button", { name: /Siguiente/ }).click();
  await page.getByRole("radio", { name: /Transporte/ }).click();
  await page.getByRole("button", { name: "Guardar gasto" }).click();
  await expect(page.getByText("Gasto guardado")).toBeVisible();

  await page.goto("/movimientos");
  await page.getByRole("link", { name: /Transporte/ }).first().click();
  await page.getByRole("link", { name: /Compartir este gasto/ }).click();
  await page.getByRole("checkbox", { name: "Mamá" }).check();
  await page.getByRole("radio", { name: "Por cantidad" }).click();
  await page.getByLabel("¿Cuánto le toca a Mamá?").fill("200");
  await page.getByRole("button", { name: "Compartir gasto" }).click();
  await expect(page.getByText("el gasto quedó compartido")).toBeVisible();
  await expect(page.getByRole("region", { name: "Gasto compartido" })).toContainText("⏳ Te lo debe");
  await expect(page.getByRole("region", { name: "Gasto compartido" })).toContainText("$100.00");

  const mama = await (await browser.newContext({ viewport: { width: 360, height: 800 } })).newPage();
  await loginAs(mama, E2E_USERS.mama);
  const card = mama.getByRole("article", { name: "Gasto compartido: Transporte" });
  await expect(card).toContainText("Te toca $200.00");
  await card.getByRole("button", { name: "Esto no es mío" }).click();
  await mama.getByRole("button", { name: "Sí, no es mío" }).click();
  await expect(card).toContainText("Le avisamos a Daniel que no te toca.");

  await page.goto("/");
  const aviso = page.getByRole("article", { name: "Gasto compartido: Transporte" });
  await expect(aviso).toContainText("Mamá dice que Transporte ($200.00) no le toca.");
  await aviso.getByRole("button", { name: "Entendido" }).click();
  await expect(aviso).toHaveCount(0);
});
