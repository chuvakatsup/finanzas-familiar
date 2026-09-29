"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CardIcon, HomeIcon, MenuIcon, PlusIcon } from "./icons";

const items = [
  { href: "/", label: "Inicio", Icon: HomeIcon },
  { href: "/registrar", label: "Registrar", Icon: PlusIcon, primary: true },
  { href: "/cuentas", label: "Mis cuentas", Icon: CardIcon },
  { href: "/mas", label: "Más", Icon: MenuIcon },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Navegación inferior: 4 opciones con icono + texto, botón central destacado. */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-4">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const primary = "primary" in item && item.primary;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-[var(--nav-h)] flex-col items-center justify-start gap-1 px-1 py-2 text-center text-sm font-semibold leading-tight ${
                  active ? "text-primary" : "text-muted"
                }`}
              >
                {/* Caja de icono de alto fijo para que todas las etiquetas queden alineadas. */}
                <span aria-hidden="true" className="flex h-11 items-center justify-center">
                  {primary ? (
                    <span className="flex size-11 items-center justify-center rounded-full bg-primary text-on-primary">
                      <item.Icon className="size-7" strokeWidth={2.75} />
                    </span>
                  ) : (
                    <item.Icon className="size-8" />
                  )}
                </span>
                <span className={active ? "underline decoration-2 underline-offset-4" : undefined}>
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
