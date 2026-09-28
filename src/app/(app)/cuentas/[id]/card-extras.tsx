import Link from "next/link";
import type { CardStatement } from "@/server/services/cards";
import type { PurchaseView } from "@/server/services/msi";
import { capitalize } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { formatDay } from "@/domain/months";
import { relativeDay } from "@/domain/recurrence";
import { ButtonLink, Card } from "@/components/ui";

/** Estado de cuenta estimado: pago para no generar intereses, mínimo, fecha límite. */
export function StatementBox({ st, today }: { st: CardStatement; today: string }) {
  return (
    <Card className={`mb-5 border-2 ${st.overdue ? "border-danger" : "border-border"}`}>
      <h2 className="text-2xl font-bold">Tu próximo pago</h2>
      <p className="text-base text-muted">
        Corte del {formatDay(st.statementDate)} · Estimado (tu banco tiene la cifra exacta)
      </p>
      {st.noInterestPaymentLeft > 0 ? (
        <>
          <p className="mt-3 text-lg">Para no pagar intereses, paga:</p>
          <p className={`tabular text-4xl font-extrabold ${st.overdue ? "text-danger" : "text-text"}`}>
            {formatMoney(st.noInterestPaymentLeft)}
          </p>
          <p className={`mt-1 text-lg font-semibold ${st.overdue ? "text-danger" : ""}`}>
            {st.overdue ? "⚠️ La fecha límite ya pasó: " : "Antes del "}
            {capitalize(formatDay(st.dueDate))} ({relativeDay(st.dueDate, today).toLowerCase()})
          </p>
          <div className="mt-4 rounded-xl bg-surface-2 p-3">
            <p className="text-lg">
              Pago mínimo: <strong className="tabular">{formatMoney(st.minimumPaymentLeft)}</strong>
            </p>
            {st.interestIfMinimum != null && st.interestIfMinimum > 0 && (
              <p className="mt-1 text-base text-warn">
                <span aria-hidden="true">⚠️ </span>Si solo pagas el mínimo, te cobrarían aprox.{" "}
                <strong className="tabular">{formatMoney(st.interestIfMinimum)}</strong> de intereses e IVA el siguiente
                mes.
              </p>
            )}
          </div>
        </>
      ) : (
        <p className="mt-3 text-xl font-semibold text-ok">
          <span aria-hidden="true">✅ </span>Ya cubriste tu pago de este corte. ¡Sin intereses!
        </p>
      )}
    </Card>
  );
}

export function MsiList({ purchases, cardId }: { purchases: PurchaseView[]; cardId: string }) {
  return (
    <section className="mb-6">
      <h2 className="mb-3 text-2xl font-bold">Compras a meses</h2>
      {purchases.length === 0 ? (
        <p className="mb-3 rounded-2xl bg-surface-2 p-4 text-lg text-muted">No tienes compras a meses en esta tarjeta.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-3">
          {purchases.map((p) => (
            <li key={p.id}>
              <Link
                href={`/msi/${p.id}`}
                className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 hover:bg-surface-2"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="wrap-break-word text-xl font-semibold">
                    <span aria-hidden="true">{p.categoryIcon ?? "🗓️"} </span>
                    {p.description}
                  </span>
                  <span className="tabular shrink-0 text-lg font-bold">{formatMoney(p.summary.monthly)}/mes</span>
                </span>
                <span className="text-base text-muted">
                  {p.withInterest ? "Con intereses" : "Sin intereses"} · Pago {Math.min(p.summary.paidCount + 1, p.months)} de{" "}
                  {p.months}
                </span>
                <span className="text-base">
                  {p.summary.remainingCount > 0 ? (
                    <>
                      Te faltan <strong>{p.summary.remainingCount}</strong> mensualidades ·{" "}
                      <strong className="tabular">{formatMoney(p.summary.remainingAmount)}</strong> por pagar
                    </>
                  ) : (
                    <span className="text-ok">✅ Ya se cobraron todas</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ButtonLink href={`/msi/nueva?tarjeta=${cardId}`} variant="secondary">
        <span aria-hidden="true">🗓️</span> Agregar compra a meses
      </ButtonLink>
    </section>
  );
}
