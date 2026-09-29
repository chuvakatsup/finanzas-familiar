"use client";

import { useActionState, useState } from "react";
import { sendSupportAction } from "@/server/actions/support";
import { initialFormState } from "@/lib/form-state";
import { Choice } from "@/components/choice";
import { MoneyKeypad } from "@/components/money-keypad";
import { StickyAction } from "@/components/sticky-action";
import { Alert, Button, TextField } from "@/components/ui";
import { formatMoney, parseMoney } from "@/domain/money";

const selectCls = "min-h-14 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg font-normal";

export function SendSupportForm({
  today,
  people,
  accounts,
}: {
  today: string;
  people: { id: string; name: string }[];
  accounts: { id: string; name: string; kind: string }[];
}) {
  const [state, action, pending] = useActionState(sendSupportAction, initialFormState);
  const [step, setStep] = useState<1 | 2>(1);
  const [recipientId, setRecipientId] = useState(people.length === 1 ? people[0].id : "");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState<"general" | "deuda">("general");
  const cents = parseMoney(amount || "0") ?? 0;
  const e = state.fieldErrors ?? {};
  const who = people.find((p) => p.id === recipientId)?.name;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="recipientId" value={recipientId} />
      <input type="hidden" name="amount" value={amount} />
      <input type="hidden" name="purpose" value={purpose} />
      {state.message && <Alert>{state.message}</Alert>}
      {Object.keys(e).length > 0 && <Alert>{Object.values(e).flat()[0]}</Alert>}

      {step === 1 ? (
        <>
          <fieldset className="flex flex-col gap-2" role="radiogroup">
            <legend className="mb-2 text-2xl font-bold">¿A quién?</legend>
            {people.map((p) => (
              <Choice key={p.id} selected={recipientId === p.id} onSelect={() => setRecipientId(p.id)} icon="👤" title={p.name} />
            ))}
          </fieldset>
          <h2 className="text-2xl font-bold">¿Cuánto?</h2>
          <MoneyKeypad value={amount} onChange={setAmount} label="Monto del apoyo" />
          <StickyAction>
            <Button type="button" disabled={!recipientId || cents <= 0} onClick={() => setStep(2)}>
              Siguiente →
            </Button>
          </StickyAction>
        </>
      ) : (
        <>
          <p className="rounded-2xl bg-surface-2 px-4 py-3 text-xl">
            <strong className="tabular">{formatMoney(cents)}</strong> para <strong>{who}</strong>
          </p>
          <fieldset className="flex flex-col gap-2" role="radiogroup">
            <legend className="mb-2 text-xl font-bold">¿Para qué es?</legend>
            <Choice selected={purpose === "general"} onSelect={() => setPurpose("general")} icon="💰" title="Para lo que necesite" />
            <Choice
              selected={purpose === "deuda"}
              onSelect={() => setPurpose("deuda")}
              icon="💳"
              title="Para pagar una deuda"
              detail={`${who} elige a cuál aplicarlo al recibirlo`}
            />
          </fieldset>
          <label className="flex flex-col gap-1 text-lg font-semibold">
            ¿De qué cuenta sale?
            <select name="fromAccountId" defaultValue={accounts.find((a) => a.kind === "debito")?.id ?? accounts[0]?.id} className={selectCls}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <TextField label="Fecha" name="date" type="date" defaultValue={today} errors={e.date} />
          <TextField label="Nota (opcional)" name="note" maxLength={120} placeholder="Ej. para tu tarjeta Liverpool" errors={e.note} />
          <label className="flex flex-col gap-1 text-lg font-semibold">
            ¿Se repite?
            <select name="repeat" defaultValue="no" className={selectCls}>
              <option value="no">No, solo esta vez</option>
              <option value="semanal">Cada semana</option>
              <option value="quincenal">Cada quincena</option>
              <option value="mensual">Cada mes</option>
            </select>
          </label>
          <StickyAction>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Enviar apoyo"}
            </Button>
          </StickyAction>
          <Button type="button" variant="secondary" onClick={() => setStep(1)}>
            ← Regresar
          </Button>
        </>
      )}
    </form>
  );
}
