import type { Cents } from "./money";

/**
 * Cuentas / formas de pago.
 * Convención de saldo: positivo = dinero que tienes; negativo = dinero que debes
 * (tarjeta de crédito, préstamo). Un gasto con tarjeta vuelve el saldo más negativo;
 * pagar la tarjeta es una transferencia que lo acerca a cero.
 */
export const ACCOUNT_KINDS = ["efectivo", "debito", "credito", "ahorro", "prestamo"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** Tipos que se pueden crear hoy (préstamos llegan con su tabla de pagos en la fase 6). */
export const CREATABLE_ACCOUNT_KINDS = ["efectivo", "debito", "credito", "ahorro"] as const;

export const ACCOUNT_KIND_INFO: Record<
  AccountKind,
  { label: string; icon: string; help: string; isDebt: boolean }
> = {
  efectivo: { label: "Efectivo", icon: "💵", help: "El dinero que traes en la cartera o en casa.", isDebt: false },
  debito: { label: "Tarjeta de débito", icon: "🏦", help: "Tu cuenta del banco (nómina, pensión).", isDebt: false },
  credito: { label: "Tarjeta de crédito", icon: "💳", help: "Tarjeta con la que compras y pagas después.", isDebt: true },
  ahorro: { label: "Ahorro", icon: "🐷", help: "Dinero guardado que no usas en el día a día.", isDebt: false },
  prestamo: { label: "Préstamo", icon: "📄", help: "Dinero que te prestaron y vas pagando.", isDebt: true },
};

/** Un movimiento visto desde el saldo: sale de `from` y entra a `to` (cualquiera puede faltar). */
export type BalanceMove = { amount: Cents; fromAccountId: string | null; toAccountId: string | null };

/** Saldo = saldo inicial + lo que entró − lo que salió. */
export function accountBalance(accountId: string, opening: Cents, moves: readonly BalanceMove[]): Cents {
  let balance = opening;
  for (const m of moves) {
    if (m.toAccountId === accountId) balance += m.amount;
    if (m.fromAccountId === accountId) balance -= m.amount;
  }
  return balance;
}

export type CreditSummary = {
  /** Lo que debes (positivo). */
  owed: Cents;
  /** Lo que aún puedes gastar (null si no se capturó límite). */
  available: Cents | null;
  /** Saldo a favor (pagaste de más). */
  inFavor: Cents;
};

export function creditSummary(balance: Cents, limit: Cents | null): CreditSummary {
  const owed = Math.max(0, -balance);
  return {
    owed,
    inFavor: Math.max(0, balance),
    available: limit == null ? null : limit + balance,
  };
}

/** Días de corte/pago válidos: 1–31 (si el mes es más corto se usa el último día). */
export function isValidDayOfMonth(day: number) {
  return Number.isInteger(day) && day >= 1 && day <= 31;
}
