"use client";

import { useActionState, useMemo, useState } from "react";
import { createLoanAction } from "@/server/actions/credit";
import { PERIODICITIES, PERIODICITY_LABEL, type Periodicity, buildSchedule, parseRatePct } from "@/domain/amortization";
import { formatMoney, parseMoney } from "@/domain/money";
import { initialFormState } from "@/lib/form-state";
import { Alert, Button, TextField } from "@/components/ui";
import { StickyAction } from "@/components/sticky-action";

const selectCls = "min-h-14 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg font-normal";

export function LoanForm({ today, accounts }: { today: string; accounts: { id: string; name: string; kind: string }[] }) {
  const [state, action, pending] = useActionState(createLoanAction, initialFormState);
  const [informal, setInformal] = useState(false);
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("");
  const [withIva, setWithIva] = useState(true);
  const [periodicity, setPeriodicity] = useState<Periodicity>("mensual");
  const [n, setN] = useState("12");
  const [first, setFirst] = useState(today);
  const [started, setStarted] = useState(false);
  const e = state.fieldErrors ?? {};

  // Vista previa de la cuota mientras escribe (mismo cálculo que el servidor).
  const preview = useMemo(() => {
    const p = parseMoney(principal);
    const bp = informal ? 0 : parseRatePct(rate || "0");
    const count = Number(n);
    if (!p || bp == null || !Number.isInteger(count) || count < 1 || count > 1000 || !first) return null;
    try {
      const rows = buildSchedule({ principal: p, annualRateBp: bp, ivaPct: informal || !withIva ? 0 : 16, periodicity, nPayments: count, firstDate: first });
      return { payment: rows[0]?.payment ?? 0, total: rows.reduce((s, r) => s + r.payment, 0), last: rows.at(-1)?.dueDate };
    } catch {
      return null;
    }
  }, [principal, rate, informal, withIva, periodicity, n, first]);

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.message && <Alert>{state.message}</Alert>}
      <input type="hidden" name="periodicity" value={periodicity} />

      <TextField label="¿Quién te prestó?" name="name" placeholder="Ej. Banco Azteca, Mi hermano Luis" maxLength={40} errors={e.name} />

      <label className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-lg font-semibold">
        <input type="checkbox" name="informal" checked={informal} onChange={(ev) => setInformal(ev.target.checked)} className="size-7 shrink-0 accent-[var(--primary)]" />
        Es de familia o amigos, sin intereses
      </label>

      <TextField
        label="¿Cuánto te prestaron?"
        name="principal"
        inputMode="decimal"
        placeholder="0.00"
        value={principal}
        onChange={(ev) => setPrincipal(ev.target.value)}
        errors={e.principal}
      />

      {!informal && (
        <>
          <TextField
            label="Tasa de interés anual (%)"
            hint="Viene en tu contrato. Ej. 36 o 42.5"
            name="annualRateBp"
            inputMode="decimal"
            value={rate}
            onChange={(ev) => setRate(ev.target.value)}
            errors={e.annualRateBp}
          />
          <label className="flex min-h-12 items-center gap-3 text-lg">
            <input type="checkbox" name="withIva" checked={withIva} onChange={(ev) => setWithIva(ev.target.checked)} className="size-7 shrink-0 accent-[var(--primary)]" />
            Me cobran IVA sobre los intereses (16%)
          </label>
        </>
      )}

      <fieldset>
        <legend className="mb-2 text-lg font-semibold">¿Cada cuándo pagas?</legend>
        <div className="grid grid-cols-3 gap-2">
          {PERIODICITIES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={periodicity === p}
              onClick={() => setPeriodicity(p)}
              className={`min-h-14 rounded-2xl border-2 px-1 text-base font-semibold leading-tight ${
                periodicity === p ? "border-primary bg-primary text-on-primary" : "border-border bg-surface"
              }`}
            >
              {PERIODICITY_LABEL[p]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <TextField label="¿Cuántos pagos en total?" name="nPayments" inputMode="numeric" value={n} onChange={(ev) => setN(ev.target.value)} errors={e.nPayments} />
        <TextField label="Fecha del primer pago" name="firstPaymentDate" type="date" value={first} onChange={(ev) => setFirst(ev.target.value)} errors={e.firstPaymentDate} />
      </div>

      {preview && (
        <p className="rounded-2xl bg-surface-2 p-4 text-lg">
          Cuota de <strong className="tabular text-xl">{formatMoney(preview.payment)}</strong>
          {PERIODICITY_LABEL[periodicity].replace("Cada", " cada").toLowerCase()}. En total pagarás{" "}
          <strong className="tabular">{formatMoney(preview.total)}</strong>.
        </p>
      )}

      <label className="flex flex-col gap-1 text-lg font-semibold">
        ¿Con qué cuenta pagas?
        <select name="payFromAccountId" defaultValue={accounts.find((a) => a.kind === "debito")?.id ?? accounts[0]?.id} className={selectCls}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {e.payFromAccountId && <span className="text-base text-danger">⚠️ {e.payFromAccountId[0]}</span>}
      </label>

      <div className="rounded-2xl border border-border bg-surface p-4">
        <label className="flex min-h-12 items-center gap-3 text-lg font-semibold">
          <input type="checkbox" name="alreadyStarted" checked={started} onChange={(ev) => setStarted(ev.target.checked)} className="size-7 shrink-0 accent-[var(--primary)]" />
          Ya llevo pagos de este préstamo
        </label>
        {started && (
          <div className="mt-3 flex flex-col gap-4">
            <TextField
              label="¿Cuántos pagos ya hiciste?"
              hint="La fecha del primer pago de arriba es la del PRIMER pago del préstamo (aunque ya haya pasado)."
              name="paidBefore"
              inputMode="numeric"
              errors={e.paidBefore}
            />
            <TextField
              label="¿Cuánto debes hoy según tu estado de cuenta? (opcional)"
              hint="Si no coincide con nuestro cálculo, ajustamos la tabla a lo que dice tu banco."
              name="currentBalance"
              inputMode="decimal"
              errors={e.currentBalance}
            />
          </div>
        )}
      </div>

      {!informal && (
        <details className="rounded-2xl border border-border bg-surface p-4">
          <summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">Más datos (opcional)</summary>
          <div className="mt-3 flex flex-col gap-4">
            <TextField label="Comisión por apertura" name="openingFee" inputMode="decimal" errors={e.openingFee} />
            <TextField label="CAT (%) — solo para tu referencia" name="catBp" inputMode="decimal" errors={e.catBp} />
          </div>
        </details>
      )}

      <StickyAction>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar préstamo"}
        </Button>
      </StickyAction>
    </form>
  );
}
