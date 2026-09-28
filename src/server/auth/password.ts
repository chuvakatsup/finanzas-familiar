import { hash, verify } from "@node-rs/argon2";

// argon2id (algoritmo por defecto de @node-rs/argon2) con parámetros por encima del mínimo de OWASP.
const ARGON2_OPTIONS = { memoryCost: 47104, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Hash de relleno: si el correo no existe se verifica contra este para que la respuesta tarde
// lo mismo y no se pueda adivinar qué correos están registrados.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("contraseña-de-relleno-que-nunca-coincide");
  return dummyHash;
}
