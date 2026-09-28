import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "Falta DATABASE_URL"),
  // URL pública (https://finanzas.midominio.com). Se usa para armar enlaces de invitación.
  APP_URL: z.url().default("http://localhost:3000"),
  // En desarrollo por http se puede apagar; en producción siempre true.
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

/** Lee y valida variables de entorno la primera vez que se necesitan (no en build). */
export function serverEnv(): ServerEnv {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        "Variables de entorno inválidas: " +
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    cached = parsed.data;
  }
  return cached;
}
