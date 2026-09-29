"use client";

import { type Cents, centsToInput, formatMoney, splitEvenly } from "@/domain/money";
import { type SplitMode, type SplitResult, computeShares, evenPercentText, parsePartValue } from "@/domain/shared";
import { Choice } from "./choice";

export type Member = { id: string; name: string };

/** Personas marcadas (llaves) y lo que escribió para cada una ("50" o "1500"). */
export type SplitState = { mode: SplitMode; values: Record<string, string> };
export const emptySplit: SplitState = { mode: "porcentaje", values: {} };

/** Lo que se manda al servidor en el campo "shared" ("" = no se comparte). */
export function splitPayload(state: SplitState): string {
  const parts = Object.entries(state.values).map(([userId, value]) => ({ userId, value }));
  return parts.length ? JSON.stringify({ mode: state.mode, parts }) : "";
}

/** Cálculo en vivo (el mismo que hace el servidor). Null si aún no hay nadie marcado. */
export function splitPreview(total: Cents, state: SplitState): SplitResult | null {
  const entries = Object.entries(state.values);
  if (!entries.length) return null;
  const parts = [];
  for (const [userId, text] of entries) {
    const value = parsePartValue(state.mode, text);
    if (value == null) {
      return {
        ok: false,
        error: state.mode === "porcentaje" ? "Escribe el porcentaje de cada persona (del 1 al 100)." : "Escribe cuánto le toca a cada persona.",
      };
    }
    parts.push({ userId, value });
  }
  return computeShares(total, state.mode, parts);
}

/** Partes iguales entre las personas marcadas y quien paga. */
function evenValues(mode: SplitMode, ids: string[], total: Cents): Record<string, string> {
  if (!ids.length) return {};
  const text = mode === "porcentaje" ? evenPercentText(ids.length + 1) : total > 0 ? centsToInput(splitEvenly(total, ids.length + 1)[0]) : "";
  return Object.fromEntries(ids.map((id) => [id, text]));
}

const inputCls = "min-h-14 w-full rounded-xl border-2 border-border bg-surface px-4 text-lg text-text tabular";

/**
 * "¿Con quién lo compartes?": marcar personas de la familia y cuánto le toca a cada una,
 * en porcentaje o en pesos. Al marcar a alguien se proponen partes iguales.
 */
export function SplitEditor({
  members,
  total,
  value,
  onChange,
}: {
  members: Member[];
  total: Cents;
  value: SplitState;
  onChange: (next: SplitState) => void;
}) {
  const selected = Object.keys(value.values);
  const preview = splitPreview(total, value);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "";

  function toggle(id: string) {
    const ids = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange({ ...value, values: evenValues(value.mode, ids, total) });
  }

  function setMode(mode: SplitMode) {
    if (mode !== value.mode) onChange({ mode, values: evenValues(mode, selected, total) });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border-2 border-primary bg-surface p-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-lg font-semibold">¿Con quién lo compartes?</legend>
        {members.map((m) => (
          <label
            key={m.id}
            className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 text-lg font-semibold ${
              selected.includes(m.id) ? "border-primary bg-surface-2" : "border-border bg-surface"
            }`}
          >
            <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} className="size-6 accent-primary" />
            {m.name}
          </label>
        ))}
      </fieldset>

      {selected.length > 0 && (
        <>
          {/* Una debajo de otra: a 360px, dos columnas no caben con la palomita. */}
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="¿Cómo lo reparten?">
            <Choice selected={value.mode === "porcentaje"} onSelect={() => setMode("porcentaje")} icon="%" title="Por porcentaje" detail="Ej. mitad y mitad = 50%" />
            <Choice selected={value.mode === "monto"} onSelect={() => setMode("monto")} icon="$" title="Por cantidad" detail="Cuántos pesos le tocan" />
          </div>

          {selected.map((id) => (
            <label key={id} className="flex flex-col gap-1 text-lg font-semibold">
              {value.mode === "porcentaje" ? `¿Qué porcentaje le toca a ${nameOf(id)}?` : `¿Cuánto le toca a ${nameOf(id)}?`}
              <span className="flex items-center gap-2">
                {value.mode === "monto" && <span aria-hidden="true" className="text-xl">$</span>}
                <input
                  inputMode="decimal"
                  value={value.values[id]}
                  onChange={(e) => onChange({ ...value, values: { ...value.values, [id]: e.target.value } })}
                  className={inputCls}
                />
                {value.mode === "porcentaje" && <span aria-hidden="true" className="text-xl">%</span>}
              </span>
            </label>
          ))}

          <div role="status" aria-live="polite" className="rounded-xl bg-surface-2 p-3 text-lg">
            {preview?.ok ? (
              <ul className="flex flex-col gap-1">
                {preview.shares.map((s) => (
                  <li key={s.userId} className="flex justify-between gap-3">
                    <span>{nameOf(s.userId)} te debe</span>
                    <strong className="tabular">{formatMoney(s.amount)}</strong>
                  </li>
                ))}
                <li className="flex justify-between gap-3 border-t border-border pt-1">
                  <span>Tu parte</span>
                  <strong className="tabular">{formatMoney(preview.ownerShare)}</strong>
                </li>
              </ul>
            ) : preview ? (
              <p className="font-semibold text-danger">
                <span aria-hidden="true">⚠️ </span>
                {preview.error}
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
