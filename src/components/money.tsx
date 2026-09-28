import { formatMoney, type Cents } from "@/domain/money";
import { type TxKind, txDirection } from "@/domain/transactions";

/** Monto de un movimiento con signo, color Y texto (no solo color). */
export function TxAmount({ kind, amount, className = "" }: { kind: TxKind; amount: Cents; className?: string }) {
  const dir = txDirection(kind);
  const styles = { sale: "text-danger", entra: "text-ok", mueve: "text-text" }[dir];
  const sign = { sale: "−", entra: "+", mueve: "" }[dir];
  const spoken = { sale: "salió", entra: "entró", mueve: "se movió" }[dir];
  return (
    <span className={`tabular whitespace-nowrap font-bold ${styles} ${className}`}>
      <span className="sr-only">{spoken} </span>
      <span aria-hidden="true">{sign}</span>
      {formatMoney(amount)}
    </span>
  );
}

/** Cifra grande de pantalla. */
export function BigMoney({ cents, tone = "text" }: { cents: Cents; tone?: "text" | "ok" | "danger" }) {
  const color = { text: "text-text", ok: "text-ok", danger: "text-danger" }[tone];
  return <span className={`tabular text-4xl font-bold ${color}`}>{formatMoney(cents)}</span>;
}
