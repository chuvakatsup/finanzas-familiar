import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { AuthzError } from "@/server/authz";
import { listAccounts } from "@/server/services/accounts";
import { listCategories } from "@/server/services/categories";
import { getScheduled, listScheduled, scheduleOf } from "@/server/services/scheduled";
import { setScheduledArchivedAction } from "@/server/actions/scheduled";
import { capitalize, todayIso } from "@/domain/dates";
import { centsToInput, formatMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { LAST_DAY, describeSchedule, nextOccurrence, relativeDay } from "@/domain/recurrence";
import { ConfirmButton } from "@/components/confirm-button";
import { Alert, ButtonLink, PageTitle } from "@/components/ui";
import { ScheduledForm } from "./scheduled-form";

type Kind = "ingreso" | "pago";

const TEXT = {
  pago: {
    base: "/pagos-fijos",
    title: "Pagos fijos y servicios",
    subtitle: "Renta, luz, teléfono, suscripciones… lo que pagas cada cierto tiempo.",
    add: "Agregar pago fijo",
    empty: "Aún no tienes pagos fijos. Agrega la luz, el agua, la renta o lo que pagues seguido.",
    newTitle: "Nuevo pago fijo",
    editTitle: "Editar pago fijo",
  },
  ingreso: {
    base: "/ingresos-fijos",
    title: "Mis ingresos fijos",
    subtitle: "Sueldo, pensión, rentas… el dinero que te llega cada cierto tiempo.",
    add: "Agregar ingreso fijo",
    empty: "Aún no tienes ingresos fijos. Agrega tu pensión o tu sueldo para saber con cuánto cuentas.",
    newTitle: "Nuevo ingreso fijo",
    editTitle: "Editar ingreso fijo",
  },
} as const;

async function formOptions(kind: Kind, keepAccountId?: string, keepCategoryId?: string | null) {
  const actor = await requireUser();
  const db = getDb();
  const [accounts, categories] = await Promise.all([
    listAccounts(db, actor, { includeArchived: true }),
    listCategories(db, actor, kind === "pago" ? "gasto" : "ingreso", { includeArchived: true }),
  ]);
  return {
    actor,
    accounts: accounts
      .filter((a) => !a.archivedAt || a.id === keepAccountId)
      .filter((a) => kind === "pago" || (a.kind !== "credito" && a.kind !== "prestamo"))
      .map(({ id, name }) => ({ id, name })),
    categories: categories
      .filter((c) => !c.archived || c.id === keepCategoryId)
      .map(({ id, name, icon }) => ({ id, name, icon })),
  };
}

export async function ScheduledListPage({ kind, searchParams }: { kind: Kind; searchParams: Record<string, unknown> }) {
  const t = TEXT[kind];
  const actor = await requireUser();
  const today = todayIso();
  const items = await listScheduled(getDb(), actor, kind, { today });

  return (
    <>
      <PageTitle subtitle={t.subtitle}>{t.title}</PageTitle>
      {searchParams.guardado && <Alert kind="ok">Guardado.</Alert>}
      {searchParams.quitado && <Alert kind="ok">Se quitó. Lo ya registrado se conserva.</Alert>}

      {items.length === 0 ? (
        <p className="my-5 rounded-2xl bg-surface-2 p-5 text-lg">{t.empty}</p>
      ) : (
        <ul className="my-5 flex flex-col gap-3">
          {items.map((i) => (
            <li key={i.id}>
              <Link
                href={`${t.base}/${i.id}`}
                className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 hover:bg-surface-2"
              >
                <span className="flex items-start gap-3">
                  <span aria-hidden="true" className="text-3xl">
                    {i.categoryIcon ?? (kind === "pago" ? "🧾" : "💰")}
                  </span>
                  <span className="flex-1 wrap-break-word text-xl font-semibold leading-snug">{i.name}</span>
                  <span className={`tabular text-xl font-bold ${kind === "pago" ? "text-danger" : "text-ok"}`}>
                    {formatMoney(i.amount)}
                    {i.amountIsEstimate && <span className="block text-right text-sm font-normal text-muted">aprox.</span>}
                  </span>
                </span>
                <span className="text-base text-muted">
                  {describeSchedule(scheduleOf(i))}
                  {i.autoRegister ? " · automático" : ""}
                </span>
                <span className="text-base">
                  {i.nextDate ? (
                    <>
                      Próximo: <strong>{relativeDay(i.nextDate, today)}</strong> ({formatDay(i.nextDate)})
                    </>
                  ) : (
                    "Ya no tiene fechas próximas"
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-3">
        <ButtonLink href={`${t.base}/nuevo`}>
          <span aria-hidden="true">➕</span> {t.add}
        </ButtonLink>
        <ButtonLink href="/proximos" variant="secondary">
          <span aria-hidden="true">📅</span> Ver próximos pagos
        </ButtonLink>
      </div>
    </>
  );
}

export async function ScheduledNewPage({ kind }: { kind: Kind }) {
  const t = TEXT[kind];
  const { accounts, categories } = await formOptions(kind);
  const today = todayIso();
  const defaultCategory =
    categories.find((c) => (kind === "pago" ? c.name === "Luz, agua y gas" : c.name === "Pensión")) ?? categories[0];
  return (
    <>
      <PageTitle>{t.newTitle}</PageTitle>
      {accounts.length === 0 ? (
        <Alert kind="warn">Primero agrega una cuenta en “Mis cuentas”.</Alert>
      ) : (
        <ScheduledForm
          kind={kind}
          today={today}
          accounts={accounts}
          categories={categories}
          values={{
            name: "",
            amount: "",
            amountIsEstimate: false,
            frequency: kind === "ingreso" ? "quincenal" : "mensual",
            nextDate: today,
            day1: kind === "ingreso" ? 15 : Number(today.slice(8, 10)),
            day2: LAST_DAY,
            accountId: accounts[0].id,
            categoryId: defaultCategory?.id ?? "",
            autoRegister: false,
          }}
        />
      )}
    </>
  );
}

export async function ScheduledEditPage({ kind, id }: { kind: Kind; id: string }) {
  const t = TEXT[kind];
  const actor = await requireUser();
  const item = await getScheduled(getDb(), actor, id).catch((e) => {
    if (e instanceof AuthzError) notFound();
    throw e;
  });
  if (item.kind !== kind) notFound();
  const { accounts, categories } = await formOptions(kind, item.accountId, item.categoryId);
  const today = todayIso();
  const next = nextOccurrence(scheduleOf(item), today);
  return (
    <>
      <PageTitle subtitle={capitalize(describeSchedule(scheduleOf(item)))}>{t.editTitle}</PageTitle>
      <ScheduledForm
        kind={kind}
        today={today}
        accounts={accounts}
        categories={categories}
        values={{
          id: item.id,
          name: item.name,
          amount: centsToInput(item.amount),
          amountIsEstimate: item.amountIsEstimate,
          frequency: item.frequency,
          nextDate: next ?? item.startDate,
          day1: item.day1 ?? 15,
          day2: item.day2 ?? LAST_DAY,
          accountId: item.accountId,
          categoryId: item.categoryId ?? "",
          autoRegister: item.autoRegister,
        }}
      />
      <form action={setScheduledArchivedAction} className="mt-8">
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="archived" value="1" />
        <ConfirmButton
          title={kind === "pago" ? "¿Quitar este pago fijo?" : "¿Quitar este ingreso fijo?"}
          message={<p>Dejará de aparecer en tus próximos pagos. Lo que ya registraste se conserva.</p>}
          confirmLabel="Sí, quitar"
        >
          <span aria-hidden="true">🗑️</span> Quitar
        </ConfirmButton>
      </form>
    </>
  );
}
