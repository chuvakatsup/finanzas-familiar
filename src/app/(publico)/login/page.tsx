import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current";
import { Card } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <Card>
      <h1 className="mb-5 text-3xl font-bold">Entrar</h1>
      <LoginForm />
      <p className="mt-6 text-base text-muted">
        ¿Olvidaste tu contraseña? Pídele a quien administra la familia un enlace para crear una nueva.
      </p>
    </Card>
  );
}
