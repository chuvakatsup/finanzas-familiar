import { type Cents, mulRound, parseMoney } from "./money";
import { parseRatePct } from "./amortization";

/**
 * GASTOS COMPARTIDOS: quien paga (el "dueño" del cargo) reparte una parte a otros de la familia,
 * en porcentaje o en pesos. Lo que no se reparte es la parte del dueño.
 *
 * Sin doble conteo:
 * - El cargo completo sigue en la cuenta del dueño (la deuda real de la tarjeta es suya), pero en
 *   SU balance solo cuenta su parte: lo de los demás se descuenta del gasto (`ownShareTxs`).
 * - Para quien debe, su parte pendiente es un compromiso del mes; al decir "Ya te pagué" se vuelve
 *   un gasto real en su cuenta.
 * - Cuando el dueño confirma que le llegó, entra como "reembolso" (no es ingreso: ya no contaba
 *   como su gasto). Puede entrar directo a la tarjeta y así baja la deuda.
 */

export const SPLIT_MODES = ["porcentaje", "monto"] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

/** `value`: puntos base (50% = 5000) en modo porcentaje; centavos en modo monto. */
export type SplitPart = { userId: string; value: number };
export type Share = { userId: string; amount: Cents; percentBp: number | null };

export type SplitResult = { ok: true; shares: Share[]; ownerShare: Cents } | { ok: false; error: string };

const FULL_BP = 10_000;

/** Reparte `total` según las partes. El residuo del redondeo va en la última parte si suman 100%. */
export function computeShares(total: Cents, mode: SplitMode, parts: readonly SplitPart[]): SplitResult {
  if (parts.length === 0) return { ok: false, error: "Elige con quién compartes el gasto." };
  if (new Set(parts.map((p) => p.userId)).size !== parts.length) {
    return { ok: false, error: "Cada persona puede aparecer una sola vez." };
  }
  if (parts.some((p) => !Number.isInteger(p.value) || p.value <= 0)) {
    return { ok: false, error: "Escribe cuánto le toca a cada persona (mayor a cero)." };
  }

  let shares: Share[];
  if (mode === "porcentaje") {
    const sumBp = parts.reduce((s, p) => s + p.value, 0);
    if (sumBp > FULL_BP) return { ok: false, error: "Los porcentajes suman más de 100%." };
    shares = parts.map((p) => ({ userId: p.userId, amount: mulRound(total, p.value / FULL_BP), percentBp: p.value }));
    const sum = shares.reduce((s, x) => s + x.amount, 0);
    // Con 100% exacto (o si el redondeo se pasa), la última parte absorbe la diferencia.
    if (sumBp === FULL_BP || sum > total) shares[shares.length - 1].amount += total - sum;
  } else {
    shares = parts.map((p) => ({ userId: p.userId, amount: p.value, percentBp: null }));
    if (shares.reduce((s, x) => s + x.amount, 0) > total) {
      return { ok: false, error: "Las partes suman más que el gasto." };
    }
  }

  if (shares.some((s) => s.amount <= 0)) {
    return { ok: false, error: "Una de las partes queda en $0. Súbele un poco." };
  }
  const ownerShare = total - shares.reduce((s, x) => s + x.amount, 0);
  return { ok: true, shares, ownerShare };
}

/** Texto que escribe la persona ("50", "33.5", "1500") → valor de la parte, o null si no se entiende. */
export function parsePartValue(mode: SplitMode, text: string): number | null {
  if (mode === "porcentaje") {
    const bp = parseRatePct(text);
    return bp != null && bp > 0 && bp <= FULL_BP ? bp : null;
  }
  const cents = parseMoney(text);
  return cents != null && cents > 0 ? cents : null;
}

/** Porcentaje igual para todos (incluido quien paga), para proponerlo al marcar a alguien. */
export function evenPercentText(people: number): string {
  const bp = Math.floor(FULL_BP / people);
  return bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2);
}

/**
 * Balance del dueño: a cada gasto compartido se le quita lo que les toca a los demás
 * (los que quedan en $0 desaparecen). `sharedOut`: id del movimiento → centavos repartidos.
 */
export function ownShareTxs<T extends { id: string; amount: Cents }>(txs: readonly T[], sharedOut: ReadonlyMap<string, Cents>): T[] {
  if (sharedOut.size === 0) return [...txs];
  const out: T[] = [];
  for (const tx of txs) {
    const others = sharedOut.get(tx.id) ?? 0;
    const own = tx.amount - Math.min(others, tx.amount);
    if (own > 0) out.push(others > 0 ? { ...tx, amount: own } : tx);
  }
  return out;
}
