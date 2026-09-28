import { z } from "zod";

// Esquemas compartidos cliente/servidor. Mensajes en español sencillo.

export const PASSWORD_MIN = 10;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `La contraseña debe tener al menos ${PASSWORD_MIN} letras o números.`)
  .max(200, "La contraseña es demasiado larga.");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Revisa tu correo, parece que le falta algo (por ejemplo la @)."));

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Escribe tu nombre.")
  .max(60, "El nombre es demasiado largo.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Escribe tu contraseña.").max(200),
});

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((d) => d.password === d.confirm, {
    message: "Las dos contraseñas no son iguales. Escríbelas otra vez.",
    path: ["confirm"],
  });

export const acceptInvitationSchema = z
  .object({ name: nameSchema, email: emailSchema, password: passwordSchema, confirm: z.string() })
  .refine((d) => d.password === d.confirm, {
    message: "Las dos contraseñas no son iguales. Escríbelas otra vez.",
    path: ["confirm"],
  });

export const createInvitationSchema = z.object({
  suggestedName: z.string().trim().max(60).optional(),
});
