import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Card, PageTitle } from "@/components/ui";
import { InstallApp } from "@/components/install-app";

export const metadata: Metadata = { title: "Ayuda" };

function Q({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="rounded-2xl border border-border bg-surface p-4">
      <summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">{q}</summary>
      <div className="mt-2 flex flex-col gap-2 text-lg">{children}</div>
    </details>
  );
}

export default function HelpPage() {
  return (
    <>
      <PageTitle subtitle="Toca una pregunta para ver la respuesta.">Ayuda</PageTitle>

      <Card className="mb-5">
        <h2 className="mb-3 text-2xl font-bold">📲 Tener la app en tu pantalla</h2>
        <InstallApp />
      </Card>

      <div className="flex flex-col gap-3">
        <Q q="¿Qué significa el semáforo?">
          <p>
            <strong>✅ Verde:</strong> con lo que te entra este mes alcanza y te sobra.
          </p>
          <p>
            <strong>⚠️ Amarillo:</strong> alcanza, pero te sobra poco. Cuida los gastos extra.
          </p>
          <p>
            <strong>⛔ Rojo:</strong> este mes vas a gastar más de lo que te entra.
          </p>
        </Q>
        <Q q="¿Cómo anoto un gasto?">
          <p>
            Toca el botón <strong>➕ Registrar</strong> de abajo. Escribe cuánto, toca en qué fue y luego{" "}
            <strong>Guardar gasto</strong>. Si te equivocas, toca <strong>Deshacer</strong>.
          </p>
        </Q>
        <Q q="Pagué mi tarjeta, ¿lo anoto como gasto?">
          <p>
            No. Usa <strong>Registrar → Pasar dinero</strong> y elige tu tarjeta como destino. Lo que compraste con la
            tarjeta ya se contó el día de la compra; así no se cuenta dos veces.
          </p>
        </Q>
        <Q q="¿Qué es “Por confirmar”?">
          <p>
            Son pagos o ingresos que tenías programados (la luz, tu pensión…). Cuando ya los pagaste o te llegaron,
            toca <strong>✅ Ya lo pagué</strong> o <strong>✅ Ya me pagaron</strong>.
          </p>
        </Q>
        <Q q="Me mandaron un apoyo, ¿qué hago?">
          <p>
            En Inicio verás “¿Ya lo recibiste?”. Cuando el dinero ya esté en tu cuenta, toca{" "}
            <strong>Sí, ya lo recibí</strong> y elige a qué cuenta llegó.
          </p>
        </Q>
        <Q q="Pagué algo que es de varios, ¿cómo lo reparto?">
          <p>
            Al registrar el gasto, toca <strong>¿Es compartido con tu familia?</strong> y marca a quién le toca una parte,
            en porcentaje o en pesos. A ti solo te cuenta tu parte. A cada quien le aparece en Inicio lo que le toca;
            cuando te paguen, confirma a dónde te llegó (puede ser directo a tu tarjeta).
          </p>
        </Q>
        <Q q="Me aparece un gasto compartido que no es mío">
          <p>
            Toca <strong>Esto no es mío</strong>. Deja de contar para ti y le avisamos a quien lo registró.
          </p>
        </Q>
        <Q q="¿Alguien más puede ver mi dinero?">
          <p>
            No. Cada persona ve solo sus propias cuentas. Tu familia solo ve tu nombre, los apoyos que se envían entre
            ustedes y la parte que les toca de un gasto compartido (nunca tu tarjeta ni tus cuentas).
          </p>
        </Q>
        <Q q="La letra está muy chica">
          <p>
            Ve a <strong>Más → Letra, colores y avisos</strong> y elige <strong>Grande</strong> o{" "}
            <strong>Muy grande</strong>.
          </p>
        </Q>
        <Q q="Olvidé mi contraseña">
          <p>Pídele a quien administra la familia un enlace para crear una nueva. Llega por WhatsApp.</p>
        </Q>
      </div>
    </>
  );
}
