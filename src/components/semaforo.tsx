import type { MonthBalance } from "@/domain/balance";
import { formatMoney } from "@/domain/money";

const LIGHT = {
  verde: { icon: "✅", ring: "border-ok bg-ok-bg", text: "text-ok", label: "Verde" },
  amarillo: { icon: "⚠️", ring: "border-warn bg-warn-bg", text: "text-warn", label: "Amarillo" },
  rojo: { icon: "⛔", ring: "border-danger bg-danger-bg", text: "text-danger", label: "Rojo" },
  "sin-datos": { icon: "ℹ️", ring: "border-border bg-surface-2", text: "text-muted", label: "Sin datos" },
} as const;

/** Frase principal según el estado y si el mes ya pasó, es el actual o es futuro. */
export function semaforoMessage(b: MonthBalance): { title: string; amount: number | null } {
  const abs = Math.abs(b.result);
  if (b.status === "sin-datos") return { title: "Aún no hay datos de este mes", amount: null };
  if (b.position === "pasado") {
    return b.result < 0 ? { title: "Te pasaste por", amount: abs } : { title: "Te sobraron", amount: abs };
  }
  if (b.position === "futuro") {
    return b.result < 0
      ? { title: "Con lo programado, te pasarías por", amount: abs }
      : { title: "Con lo programado, te sobrarían", amount: abs };
  }
  if (b.status === "rojo") return { title: "Este mes te pasas por", amount: abs };
  if (b.status === "amarillo") return { title: "Cuidado, te quedan solo", amount: abs };
  return { title: "Vas bien, te sobran", amount: abs };
}

/** El semáforo enorme de la pantalla de inicio. Nunca depende solo del color: icono + texto. */
export function Semaforo({ balance }: { balance: MonthBalance }) {
  const light = LIGHT[balance.status];
  const msg = semaforoMessage(balance);
  const lit = (s: keyof typeof LIGHT) => balance.status === s;
  return (
    <section
      aria-label={`Semáforo: ${light.label}. ${msg.title}${msg.amount != null ? ` ${formatMoney(msg.amount)}` : ""}`}
      className={`flex flex-col gap-2 rounded-3xl border-4 p-5 ${light.ring}`}
    >
      <div className="flex items-center gap-4">
        {/* Semáforo dibujado: caja siempre oscura (como uno real); la luz encendida a color, las demás grises. */}
        <svg aria-hidden="true" viewBox="0 0 40 104" className="h-24 w-9 shrink-0">
          <rect x="1" y="1" width="38" height="102" rx="12" strokeWidth="2" className="fill-[#1f2328] stroke-[#5b6270]" />
          <circle cx="20" cy="20" r="13" className={lit("rojo") ? "fill-danger" : "fill-[#5b6270]"} />
          <circle cx="20" cy="52" r="13" className={lit("amarillo") ? "fill-warn" : "fill-[#5b6270]"} />
          <circle cx="20" cy="84" r="13" className={lit("verde") ? "fill-ok" : "fill-[#5b6270]"} />
        </svg>
        <p className={`min-w-0 flex-1 text-2xl font-bold leading-snug ${light.text}`}>
          <span aria-hidden="true">{light.icon} </span>
          {msg.title}
        </p>
      </div>
      {/* El monto en su propio renglón, con todo el ancho, para que quepa a 360px. */}
      {msg.amount != null && (
        <p className={`tabular whitespace-nowrap text-[2.5rem] font-extrabold leading-tight ${light.text}`}>
          {formatMoney(msg.amount)}
        </p>
      )}
    </section>
  );
}

/** Las 3 cifras grandes debajo del semáforo. */
export function MonthFigures({ balance }: { balance: MonthBalance }) {
  const over = balance.result < 0;
  const amount = "tabular shrink-0 whitespace-nowrap text-2xl";
  return (
    <dl className="grid grid-cols-1 gap-2">
      <div className="flex items-baseline justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
        <dt className="text-lg">Ingresos del mes</dt>
        <dd className={`${amount} font-bold text-ok`}>{formatMoney(balance.income.total)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
        <dt className="text-lg">Gastos y compromisos</dt>
        <dd className={`${amount} font-bold text-danger`}>−{formatMoney(balance.outgoings)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3 rounded-2xl border-2 border-text bg-surface p-4">
        <dt className="text-lg font-semibold">{over ? "Te pasas" : "Te queda"}</dt>
        <dd className={`${amount} font-extrabold ${over ? "text-danger" : "text-ok"}`}>
          {formatMoney(Math.abs(balance.result))}
        </dd>
      </div>
    </dl>
  );
}
