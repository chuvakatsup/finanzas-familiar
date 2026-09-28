"use client";

import { useActionState } from "react";
import { updateTransactionAction } from "@/server/actions/finance";
import type { AccountKind } from "@/domain/accounts";
import { initialFormState } from "@/lib/form-state";
import { Alert, Button, TextField } from "@/components/ui";

type Props = {
  tx: {
    id: string;
    kind: "gasto" | "ingreso" | "transferencia" | "pago_tarjeta";
    amount: string;
    date: string;
    note: string;
    categoryId: string | null;
    accountId: string | null;
    fromAccountId: string | null;
    toAccountId: string | null;
  };
  accounts: { id: string; name: string; kind: AccountKind }[];
  categories: { id: string; name: string; icon: string }[];
};

const selectCls = "min-h-14 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg";

function Select({
  label,
  name,
  defaultValue,
  children,
  error,
}: {
  label: string;
  name: string;
  defaultValue: string;
  children: React.ReactNode;
  error?: string[];
}) {
  return (
    <label className="flex flex-col gap-1 text-lg font-semibold">
      {label}
      <select name={name} defaultValue={defaultValue} className={selectCls} aria-invalid={error ? true : undefined}>
        {children}
      </select>
      {error && <span className="text-base text-danger">⚠️ {error[0]}</span>}
    </label>
  );
}

export function EditTxForm({ tx, accounts, categories }: Props) {
  const [state, action, pending] = useActionState(updateTransactionAction.bind(null, tx.id), initialFormState);
  const e = state.fieldErrors ?? {};
  const isTransfer = tx.kind === "transferencia" || tx.kind === "pago_tarjeta";
  const incomeAccounts = accounts.filter((a) => a.kind !== "credito" && a.kind !== "prestamo");

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.message && <Alert>{state.message}</Alert>}
      {state.data?.saved && <Alert kind="ok">Cambios guardados.</Alert>}
      <TextField label="Monto" name="amount" inputMode="decimal" defaultValue={tx.amount} errors={e.amount} />
      {isTransfer ? (
        <>
          <Select label="Sale de" name="fromAccountId" defaultValue={tx.fromAccountId ?? ""} error={e.fromAccountId}>
            {incomeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select label="Va a" name="toAccountId" defaultValue={tx.toAccountId ?? ""} error={e.toAccountId}>
            {accounts
              .filter((a) => a.kind !== "prestamo")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </Select>
        </>
      ) : (
        <>
          <Select label="Categoría" name="categoryId" defaultValue={tx.categoryId ?? ""} error={e.categoryId}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </Select>
          <Select
            label={tx.kind === "gasto" ? "Pagado con" : "Entró a"}
            name="accountId"
            defaultValue={tx.accountId ?? ""}
            error={e.accountId}
          >
            {(tx.kind === "ingreso" ? incomeAccounts : accounts).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </>
      )}
      <TextField label="Fecha" name="date" type="date" defaultValue={tx.date} errors={e.date} />
      <TextField label="Nota (opcional)" name="note" defaultValue={tx.note} maxLength={200} errors={e.note} />
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar cambios"}
      </Button>
    </form>
  );
}
