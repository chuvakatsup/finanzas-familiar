import { AuthzError } from "@/server/authz";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un id mal formado se trata igual que uno ajeno: "no encontrado" (y no llega a la BD). */
export function assertUuid(id: string, message = "No encontramos eso.") {
  if (!UUID_RE.test(id)) throw new AuthzError(message);
}
