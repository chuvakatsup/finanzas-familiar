"use client";

import { useActionState, useState } from "react";
import { createAccountAction, updateAccountAction } from "@/server/actions/finance";
import { ACCOUNT_KIND_INFO, CREATABLE_ACCOUNT_KINDS, type AccountKind } from "@/domain/accounts";
import { type FormState, initialFormState } from "@/lib/form-state";
import { Choice } from "@/components/choice";
import { Alert, Button, TextField } from "@/components/ui";

type Existing = {
  id: string;
  kind: AccountKind;
  name: string;
  last4: string | null;
  creditLimit: string;
  statementDay: number | null;
  paymentDueDay: number | null;
};

/** Alta (con selección de tipo) o edición de una cuenta. */
export function AccountForm({ existing }: { existing?: Existing }) {
  const [kind, setKind] = useState<AccountKind | null>(existing?.kind ?? null);
  const action = existing
    ? updateAccountAction.bind(null, existing.id)
    : (createAccountAction as (s: FormState, f: FormData) => Promise<FormState>);
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const errors = state.fieldErrors ?? {};

  if (!kind) {
    return (
      <div className="flex flex-col gap-3" role="radiogroup" aria-label="¿Qué quieres agregar?">
        <h2 className="text-2xl font-bold">¿Qué quieres agregar?</h2>
        {CREATABLE_ACCOUNT_KINDS.map((k) => (
          <Choice
            key={k}
            selected={false}
            onSelect={() => setKind(k)}
            icon={ACCOUNT_KIND_INFO[k].icon}
            title={ACCOUNT_KIND_INFO[k].label}
            detail={ACCOUNT_KIND_INFO[k].help}
          />
        ))}
        <p className="rounded-2xl bg-surface-2 p-4 text-base text-muted">
          <span aria-hidden="true">📄 </span>Los préstamos se podrán agregar pronto, con su tabla de pagos.
        </p>
      </div>
    );
  }

  const info = ACCOUNT_KIND_INFO[kind];
  const isCredit = kind === "credito";
  const placeholder = {
    efectivo: "Efectivo",
    debito: "Ej. BBVA nómina",
    credito: "Ej. BBVA Azul",
    ahorro: "Ej. Caja de ahorro",
    prestamo: "",
  }[kind];

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="kind" value={kind} />
      <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-4">
        <span aria-hidden="true" className="text-3xl">
          {info.icon}
        </span>
        <p className="flex-1 text-xl font-semibold">{info.label}</p>
        {!existing && (
          <button
            type="button"
            onClick={() => setKind(null)}
            className="min-h-12 px-2 text-base font-semibold text-primary underline underline-offset-4"
          >
            Cambiar
          </button>
        )}
      </div>

      {state.message && <Alert>{state.message}</Alert>}

      <TextField
        label="Nombre"
        name="name"
        defaultValue={existing?.name ?? (kind === "efectivo" ? "Efectivo" : "")}
        placeholder={placeholder}
        required
        maxLength={40}
        errors={errors.name}
      />

      {!existing && (
        <TextField
          label={isCredit ? "¿Cuánto debes hoy en esta tarjeta?" : "¿Cuánto tienes hoy?"}
          hint={isCredit ? "Si no debes nada, déjalo vacío." : "Puedes dejarlo vacío y corregirlo después."}
          name="balance"
          inputMode="decimal"
          placeholder="0.00"
          errors={errors.balance}
        />
      )}

      {isCredit && (
        <>
          <TextField
            label="Límite de crédito (opcional)"
            name="creditLimit"
            inputMode="decimal"
            defaultValue={existing?.creditLimit ?? ""}
            placeholder="Ej. 20000"
            errors={errors.creditLimit}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Día de corte"
              name="statementDay"
              inputMode="numeric"
              defaultValue={existing?.statementDay?.toString() ?? ""}
              placeholder="Ej. 5"
              errors={errors.statementDay}
            />
            <TextField
              label="Día límite de pago"
              name="paymentDueDay"
              inputMode="numeric"
              defaultValue={existing?.paymentDueDay?.toString() ?? ""}
              placeholder="Ej. 25"
              errors={errors.paymentDueDay}
            />
          </div>
        </>
      )}

      {kind !== "efectivo" && (
        <TextField
          label="Últimos 4 números (opcional)"
          hint="Solo para reconocerla. Nunca escribas el número completo ni el código de seguridad."
          name="last4"
          inputMode="numeric"
          maxLength={4}
          defaultValue={existing?.last4 ?? ""}
          placeholder="1234"
          errors={errors.last4}
        />
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : existing ? "Guardar cambios" : "Agregar"}
      </Button>
    </form>
  );
}
