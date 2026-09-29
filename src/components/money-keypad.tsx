"use client";

import { formatMoney, parseMoney } from "@/domain/money";
import { BackspaceIcon } from "./icons";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"] as const;

/** Aplica una tecla al texto del monto (máx. 2 decimales, 9 dígitos enteros). */
export function applyKey(value: string, key: (typeof KEYS)[number]): string {
  if (key === "⌫") return value.slice(0, -1);
  if (key === ".") {
    if (value.includes(".")) return value;
    return value === "" ? "0." : `${value}.`;
  }
  const [int, dec] = value.split(".");
  if (dec !== undefined) return dec.length >= 2 ? value : value + key;
  if (int === "0") return key; // sin ceros a la izquierda
  if (int.length >= 9) return value;
  return value + key;
}

/** Monto grande en pantalla + teclado numérico propio (botones enormes, siempre igual). */
export function MoneyKeypad({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const cents = parseMoney(value || "0") ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <div
        className="rounded-2xl border-2 border-border bg-surface px-4 py-3 text-center"
        role="status"
        aria-live="polite"
        aria-label={`${label}: ${formatMoney(cents)}`}
      >
        <p className="tabular text-5xl font-bold leading-tight" aria-hidden="true">
          {value === "" ? <span className="text-muted">$0</span> : `$${formatDisplay(value)}`}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Teclado de números">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(applyKey(value, k))}
            aria-label={k === "⌫" ? "Borrar último número" : k === "." ? "Punto decimal" : k}
            className="tabular flex min-h-14 items-center justify-center rounded-2xl border-2 border-border bg-surface text-3xl font-semibold active:bg-surface-2"
          >
            {k === "⌫" ? <BackspaceIcon className="size-9" /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "1234.5" → "1,234.5" (muestra lo que se va escribiendo, con comas). */
function formatDisplay(value: string) {
  const [int, dec] = value.split(".");
  const withCommas = Number(int || "0").toLocaleString("en-US");
  return dec === undefined ? withCommas : `${withCommas}.${dec}`;
}
