import "server-only";
import { z } from "zod";

/** Variable opcional: vacía en el .env cuenta como "no definida". */
const optionalText = <T extends z.ZodType>(inner: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), inner.optional());

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
  // Recordatorios push (opcionales). Generar con: pnpm push:keys
  VAPID_PUBLIC_KEY: optionalText(z.string()),
  VAPID_PRIVATE_KEY: optionalText(z.string()),
  VAPID_SUBJECT: z.string().default("mailto:admin@example.com"),
  // Secreto que usa el servicio "cron" para pedir el envío diario de recordatorios.
  CRON_SECRET: optionalText(z.string().min(24, "CRON_SECRET debe tener al menos 24 caracteres")),
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
