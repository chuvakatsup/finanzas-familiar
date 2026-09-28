import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { readDisplayPrefs } from "@/server/auth/display-prefs";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Mis Finanzas", template: "%s · Mis Finanzas" },
  description: "¿Me alcanza este mes? Control sencillo del dinero de la familia.",
  applicationName: "Mis Finanzas",
  appleWebApp: { capable: true, title: "Mis Finanzas", statusBarStyle: "default" },
  icons: { apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No se bloquea el zoom: la persona debe poder agrandar lo que quiera.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#101216" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render dinámico: necesario para que cada respuesta lleve el nonce de la CSP.
  await connection();
  const { letra, tema } = await readDisplayPrefs();
  return (
    <html
      lang="es-MX"
      className={`h-full antialiased ${letra !== "normal" ? `letra-${letra}` : ""}`}
      data-theme={tema === "claro" ? "light" : tema === "oscuro" ? "dark" : undefined}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
