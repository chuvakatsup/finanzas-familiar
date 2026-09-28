/**
 * Dinero en la app: SIEMPRE centavos enteros (number seguro hasta ~90 billones de pesos).
 * Nunca se hacen cuentas con pesos en flotante.
 */
export type Cents = number;

const mxnWhole = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function assertCents(value: number): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Monto inválido (debe ser centavos enteros): ${value}`);
  }
}

/** 123456 → "$1,234.56" (negativos: "-$1,234.56"). */
export function formatMoney(cents: Cents): string {
  assertCents(cents);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const pesos = Math.trunc(abs / 100);
  const rest = abs % 100;
  // Se formatea la parte entera por separado para no pasar por flotantes.
  const whole = mxnWhole.format(pesos);
  return `${sign}${whole}.${String(rest).padStart(2, "0")}`;
}

/** Igual que formatMoney pero sin centavos cuando son ,00 (para cifras grandes de pantalla). */
export function formatMoneyShort(cents: Cents): string {
  return cents % 100 === 0 ? formatMoney(cents).replace(/\.00$/, "") : formatMoney(cents);
}

/**
 * Convierte texto escrito por la persona a centavos.
 * Acepta "1234", "1,234.5", "$1,234.56", " 45.3 ". Rechaza más de 2 decimales y negativos.
 * Devuelve null si no es un monto válido.
 */
export function parseMoney(input: string): Cents | null {
  const cleaned = input.trim().replace(/\$/g, "").replace(/\s/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [intPart, decPart = ""] = cleaned.split(".");
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((acc, v) => {
    assertCents(v);
    return acc + v;
  }, 0);
}

/**
 * Multiplica centavos por una fracción y redondea "a la mitad hacia arriba" (alejándose de cero),
 * como lo hacen los bancos. Usar para intereses, IVA, porcentajes.
 */
export function mulRound(cents: Cents, factor: number): Cents {
  const raw = cents * factor;
  // Corrige ruido binario (p. ej. 1.005 * 100) antes de redondear.
  const corrected = Number(raw.toPrecision(15));
  return Math.sign(corrected) * Math.round(Math.abs(corrected));
}

/**
 * Reparte un total en `parts` pagos iguales en centavos; el residuo va en el ÚLTIMO pago
 * para que la suma cuadre exacto. Ej. 100000 / 3 → [33333, 33333, 33334].
 */
export function splitEvenly(total: Cents, parts: number): Cents[] {
  assertCents(total);
  if (!Number.isInteger(parts) || parts <= 0) throw new Error("parts debe ser entero positivo");
  const base = Math.trunc(total / parts);
  const out = Array.from({ length: parts }, () => base);
  out[parts - 1] = total - base * (parts - 1);
  return out;
}

/** Centavos → texto para un campo de formulario ("1234.50"), sin pasar por flotantes. */
export function centsToInput(cents: Cents): string {
  assertCents(cents);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
