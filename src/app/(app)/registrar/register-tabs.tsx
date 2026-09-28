import Link from "next/link";

const TABS = [
  { href: "/registrar", key: "gasto", label: "Gasto", icon: "🛒" },
  { href: "/registrar/ingreso", key: "ingreso", label: "Ingreso", icon: "💰" },
  { href: "/registrar/transferencia", key: "transferencia", label: "Pasar dinero", icon: "🔁" },
] as const;

/** Selector grande de qué se va a registrar. */
export function RegisterTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Qué quieres registrar" className="mb-4 grid grid-cols-3 gap-2">
      {TABS.map((t) => {
        const active = t.key === current;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center rounded-2xl border-2 px-1 py-1 text-center text-base font-semibold leading-tight ${
              active ? "border-primary bg-primary text-on-primary" : "border-border bg-surface text-text"
            }`}
          >
            <span aria-hidden="true" className="text-xl">
              {t.icon}
            </span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
