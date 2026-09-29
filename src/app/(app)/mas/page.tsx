import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/current";
import { logoutAction } from "@/server/actions/auth";
import { Button, Card, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Más" };

type Item = { href: string; icon: string; label: string; text: string; download?: boolean };

/** Agrupado por uso: lo diario arriba; lo que se configura una vez, abajo. */
const SECTIONS: { id: string; title: string; items: Item[] }[] = [
  {
    id: "diario",
    title: "Lo de todos los días",
    items: [
      { href: "/proximos", icon: "📅", label: "Próximos pagos", text: "Lo que toca pagar y recibir pronto" },
      { href: "/movimientos", icon: "📋", label: "Mis movimientos", text: "Todo lo que has registrado, por mes" },
      { href: "/apoyos", icon: "🤝", label: "Apoyos familiares", text: "Enviar y recibir ayuda de la familia" },
      { href: "/prestamos", icon: "📄", label: "Mis préstamos", text: "Cuánto debes y tu tabla de pagos" },
    ],
  },
  {
    id: "organizar",
    title: "Organizar mi dinero",
    items: [
      { href: "/ingresos-fijos", icon: "💼", label: "Mis ingresos fijos", text: "Pensión, sueldo, lo que te llega seguido" },
      { href: "/pagos-fijos", icon: "🧾", label: "Pagos fijos y servicios", text: "Luz, renta, teléfono, domiciliados" },
      { href: "/mas/presupuesto", icon: "🎯", label: "Mi presupuesto", text: "Cuánto quieres gastar al mes" },
      { href: "/mas/categorias", icon: "🏷️", label: "Categorías", text: "Comida, transporte… cámbialas a tu gusto" },
    ],
  },
  {
    id: "ajustes",
    title: "Ajustes y ayuda",
    items: [
      { href: "/mas/ajustes", icon: "🔠", label: "Letra, colores y avisos", text: "Letra más grande, modo oscuro, recordatorios" },
      { href: "/ayuda", icon: "❓", label: "Ayuda", text: "Cómo usar la app e instalarla en tu celular" },
      { href: "/mas/familia", icon: "👨‍👩‍👧", label: "Mi familia", text: "Quiénes están en el grupo" },
      {
        href: "/api/export/movimientos",
        icon: "⬇️",
        label: "Descargar mis datos",
        text: "Archivo para Excel con todos tus movimientos",
        download: true,
      },
    ],
  },
];

const itemCls = "flex min-h-16 items-center gap-4 rounded-2xl border border-border bg-surface p-4 hover:bg-surface-2";

function ItemContent({ item }: { item: Item }) {
  return (
    <>
      <span aria-hidden="true" className="text-3xl">
        {item.icon}
      </span>
      <span className="flex flex-col">
        <span className="text-xl font-semibold">{item.label}</span>
        <span className="text-base text-muted">{item.text}</span>
      </span>
      {!item.download && (
        <span aria-hidden="true" className="ml-auto text-2xl text-muted">
          ›
        </span>
      )}
    </>
  );
}

export default async function MorePage() {
  const user = await requireUser();
  return (
    <>
      <PageTitle subtitle={user.email}>{user.name}</PageTitle>
      {SECTIONS.map((section) => (
        <section key={section.id} aria-labelledby={`sec-${section.id}`} className="mb-6">
          <h2 id={`sec-${section.id}`} className="mb-3 text-xl font-bold text-muted">
            {section.title}
          </h2>
          <ul className="flex flex-col gap-3">
            {section.items.map((item) => (
              <li key={item.href}>
                {item.download ? (
                  // Descarga de archivo: enlace normal (no navegación de Next).
                  <a href={item.href} download className={itemCls}>
                    <ItemContent item={item} />
                  </a>
                ) : (
                  <Link href={item.href} className={itemCls}>
                    <ItemContent item={item} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Card>
        <form action={logoutAction}>
          <Button type="submit" variant="secondary">
            <span aria-hidden="true">🚪</span> Cerrar sesión
          </Button>
        </form>
      </Card>
    </>
  );
}
