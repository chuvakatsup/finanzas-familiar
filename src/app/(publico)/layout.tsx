export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8">
      <p className="mb-6 text-center text-2xl font-bold">
        <span aria-hidden="true">💰 </span>Mis Finanzas
      </p>
      {children}
    </main>
  );
}
