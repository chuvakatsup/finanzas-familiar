export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="contenido" tabIndex={-1} className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8 outline-none">
      <p className="mb-6 flex items-center justify-center gap-3 text-2xl font-bold">
        {/* <img> y no next/image: este pone un estilo en línea que la CSP bloquea. El PNG ya viene en su tamaño. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" width={48} height={48} alt="" className="size-12" />
        Mis Finanzas
      </p>
      {children}
    </main>
  );
}
