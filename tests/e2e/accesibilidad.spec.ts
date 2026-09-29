import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { E2E_USERS } from "./users";

/**
 * Revisión automática de accesibilidad (WCAG 2.2 AA) en las pantallas principales, a 360px,
 * en modo claro y oscuro. Falla si hay problemas "serios" o "críticos" (contraste, etiquetas,
 * nombres de botones, estructura, tamaño de lo que se toca…).
 */
const PAGES = [
  "/",
  "/registrar",
  "/registrar/ingreso",
  "/registrar/transferencia",
  "/apoyos/enviar",
  "/cuentas",
  "/cuentas/nueva",
  "/movimientos",
  "/proximos",
  "/mes",
  "/gastos",
  "/pagos-fijos",
  "/pagos-fijos/nuevo",
  "/ingresos-fijos",
  "/prestamos",
  "/prestamos/nuevo",
  "/msi/nueva",
  "/apoyos",
  "/mas",
  "/mas/ajustes",
  "/mas/presupuesto",
  "/mas/categorias",
  "/mas/familia",
  "/ayuda",
  "/bienvenida",
];

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${label} · ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")})`);
  expect(report, report.join("\n")).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`accesibilidad (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test("pantalla de entrar", async ({ page }) => {
      await page.goto("/login");
      await audit(page, "/login");
    });

    test("pantallas de la app", async ({ page }) => {
      test.setTimeout(180_000);
      await page.goto("/login");
      await page.getByLabel("Correo").fill(E2E_USERS.hijo.email);
      await page.getByLabel("Contraseña", { exact: true }).fill(E2E_USERS.hijo.password);
      await page.getByRole("button", { name: "Entrar" }).click();
      await page.waitForURL("/");
      for (const path of PAGES) {
        await page.goto(path);
        await audit(page, path);
      }
    });
  });
}
