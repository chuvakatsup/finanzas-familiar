import type { z } from "zod";

/** Estado que devuelven las acciones de formulario (para useActionState). */
export type FormState = {
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Datos extra para mostrar tras éxito (p. ej. enlace generado). */
  data?: Record<string, string>;
};

export const initialFormState: FormState = {};

export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
