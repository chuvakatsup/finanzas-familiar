import "server-only";
import { AuthzError } from "@/server/authz";
import type { FormState } from "@/lib/form-state";

/** Convierte errores esperados en mensajes amables; los inesperados se registran. */
export function friendlyError(e: unknown): FormState {
  if (e instanceof AuthzError) return { message: e.message };
  console.error(e);
  return { message: "Algo salió mal. Intenta de nuevo en un momento." };
}

/** Lee un campo de texto del formulario ("" si no viene). */
export function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}
