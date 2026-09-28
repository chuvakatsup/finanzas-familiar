/** Pagos comunes que se ofrecen como lista para palomear. */
export const COMMON_PAYMENTS = [
  { key: "renta", name: "Renta", category: "Casa", frequency: "mensual", estimate: false },
  { key: "luz", name: "Luz", category: "Luz, agua y gas", frequency: "bimestral", estimate: true },
  { key: "agua", name: "Agua", category: "Luz, agua y gas", frequency: "mensual", estimate: true },
  { key: "gas", name: "Gas", category: "Luz, agua y gas", frequency: "mensual", estimate: true },
  { key: "internet", name: "Teléfono e internet", category: "Teléfono e internet", frequency: "mensual", estimate: false },
  { key: "celular", name: "Celular", category: "Teléfono e internet", frequency: "mensual", estimate: false },
] as const;
