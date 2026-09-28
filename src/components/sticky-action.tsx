import type { ReactNode } from "react";

/**
 * Mantiene el botón principal (Guardar) siempre visible, pegado justo encima de la barra inferior,
 * aunque la lista de arriba sea larga.
 */
export function StickyAction({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom))] z-[5] -mx-4 flex flex-col gap-2 bg-bg/95 px-4 py-3 backdrop-blur-sm">
      {children}
    </div>
  );
}
