import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { finishWelcomeAction } from "@/server/actions/settings";
import { listAccounts } from "@/server/services/accounts";
import { todayIso } from "@/domain/dates";
import { Button, Card } from "@/components/ui";
import { IncomeStep, MoneyStep, PaymentsStep } from "./steps";

export const metadata: Metadata = { title: "Bienvenida" };

const STEPS = ["1", "2", "3"] as const;

export default async function WelcomePage({ searchParams }: PageProps<"/bienvenida">) {
  const actor = await requireUser();
  const { paso } = await searchParams;
  const step = paso === "listo" ? "listo" : STEPS.includes(paso as never) ? (paso as (typeof STEPS)[number]) : "1";
  const accounts = step === "1" || step === "listo" ? [] : await listAccounts(getDb(), actor);

  if (step === "listo") {
    return (
      <Card className="mt-6">
        <p className="text-3xl font-bold">
          <span aria-hidden="true">🎉 </span>¡Listo, {actor.name}!
        </p>
        <p className="mt-3 text-lg">
          Ya puedes ver si te alcanza el dinero este mes. Cada vez que gastes algo, tócale al botón{" "}
          <strong>➕ Registrar</strong> de abajo.
        </p>
        <form action={finishWelcomeAction} className="mt-5">
          <Button type="submit">Ver mi semáforo</Button>
        </form>
      </Card>
    );
  }

  return (
    <>
      <p className="mb-1 text-base font-semibold text-muted">Paso {step} de 3</p>
      {/* Barra de avance simple */}
      <div className="mb-5 grid grid-cols-3 gap-2" aria-hidden="true">
        {STEPS.map((s) => (
          <span key={s} className={`h-2 rounded-full ${s <= step ? "bg-primary" : "bg-surface-2"}`} />
        ))}
      </div>
      {step === "1" && <MoneyStep />}
      {step === "2" && (
        <IncomeStep
          today={todayIso()}
          accounts={accounts
            .filter((a) => a.kind !== "credito" && a.kind !== "prestamo")
            .map(({ id, name, kind }) => ({ id, name, kind }))}
        />
      )}
      {step === "3" && (
        <PaymentsStep today={todayIso()} accounts={accounts.map(({ id, name, kind }) => ({ id, name, kind }))} />
      )}
      <form action={finishWelcomeAction} className="mt-6 text-center">
        <button type="submit" className="min-h-12 text-base font-semibold text-muted underline underline-offset-4">
          Terminar después
        </button>
      </form>
    </>
  );
}
