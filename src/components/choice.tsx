"use client";

import type { ReactNode } from "react";

/** Opción grande seleccionable (tipo radio) para listas de cuentas, tipos, etc. */
export function Choice({
  selected,
  onSelect,
  icon,
  title,
  detail,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 p-3 text-left disabled:opacity-50 ${
        selected ? "border-primary bg-surface-2" : "border-border bg-surface"
      }`}
    >
      <span aria-hidden="true" className="text-3xl">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-lg font-semibold">{title}</span>
        {detail && <span className="text-base text-muted">{detail}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-lg ${
          selected ? "border-primary bg-primary text-on-primary" : "border-border"
        }`}
      >
        {selected ? "✓" : ""}
      </span>
    </button>
  );
}
