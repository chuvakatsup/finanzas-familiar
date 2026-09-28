import { ensureAutoSynced } from "@/server/sync";
import { BottomNav } from "@/components/bottom-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Valida la sesión y anota solos los domiciliados/depósitos cuya fecha ya llegó.
  await ensureAutoSynced();
  return (
    <>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-32 pt-6">{children}</main>
      <BottomNav />
    </>
  );
}
