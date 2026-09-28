/**
 * Autorización. Regla de oro: toda consulta de datos recibe un `Actor` y filtra por su
 * `id` (datos personales) o `householdId` (datos del grupo). Nunca se confía en ids que
 * vengan del cliente sin comprobar que pertenecen al actor.
 */
export type Actor = {
  id: string;
  householdId: string;
  role: "admin" | "miembro";
};

export class AuthzError extends Error {
  constructor(message = "No tienes permiso para hacer esto.") {
    super(message);
    this.name = "AuthzError";
  }
}

export function assertAdmin(actor: Actor) {
  if (actor.role !== "admin") {
    throw new AuthzError("Solo quien administra la familia puede hacer esto.");
  }
}

export function assertSameHousehold(actor: Actor, householdId: string) {
  if (actor.householdId !== householdId) throw new AuthzError();
}
