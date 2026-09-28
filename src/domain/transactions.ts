import type { AccountKind } from "./accounts";

export const TX_KINDS = [
  "gasto",
  "ingreso",
  "transferencia",
  "pago_tarjeta",
  "pago_prestamo",
  "apoyo_enviado",
  "apoyo_recibido",
  "ajuste",
] as const;
export type TxKind = (typeof TX_KINDS)[number];

export const TX_ORIGINS = ["manual", "recurrente", "msi", "prestamo", "apoyo"] as const;
export type TxOrigin = (typeof TX_ORIGINS)[number];

export const TX_KIND_INFO: Record<TxKind, { label: string; icon: string }> = {
  gasto: { label: "Gasto", icon: "🛒" },
  ingreso: { label: "Ingreso", icon: "💰" },
  transferencia: { label: "Pasar dinero entre cuentas", icon: "🔁" },
  pago_tarjeta: { label: "Pago de tarjeta", icon: "💳" },
  pago_prestamo: { label: "Pago de préstamo", icon: "📄" },
  apoyo_enviado: { label: "Apoyo enviado", icon: "🤝" },
  apoyo_recibido: { label: "Apoyo recibido", icon: "🎁" },
  ajuste: { label: "Corrección de saldo", icon: "✏️" },
};

/**
 * Tipo de un movimiento entre dos cuentas propias según la cuenta destino.
 * Pagar la tarjeta NO es gasto: el gasto ya se contó cuando se compró.
 */
export function transferKind(toKind: AccountKind): TxKind {
  if (toKind === "credito") return "pago_tarjeta";
  if (toKind === "prestamo") return "pago_prestamo";
  return "transferencia";
}

/** ¿Cuenta como gasto de consumo en "¿A dónde se va mi dinero?"? */
export function isConsumption(kind: TxKind) {
  return kind === "gasto";
}

/** Cómo se ve un movimiento para la persona: signo y tono. */
export function txDirection(kind: TxKind): "sale" | "entra" | "mueve" {
  switch (kind) {
    case "gasto":
    case "apoyo_enviado":
      return "sale";
    case "ingreso":
    case "apoyo_recibido":
      return "entra";
    default:
      return "mueve";
  }
}
