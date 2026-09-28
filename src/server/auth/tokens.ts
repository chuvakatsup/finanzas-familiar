import { createHash, randomBytes } from "node:crypto";

/** Token aleatorio de 256 bits, apto para URL y cookie. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Lo que se guarda en BD: nunca el token en claro. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
