/** Se ve mientras carga una pantalla (útil con internet lento): grande y claro. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
      <span aria-hidden="true" className="size-14 animate-spin rounded-full border-8 border-surface-2 border-t-primary" />
      <p className="text-xl font-semibold text-muted">Cargando…</p>
    </div>
  );
}
