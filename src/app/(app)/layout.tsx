import { requireUser } from "@/server/auth/current";
import { BottomNav } from "@/components/bottom-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-32 pt-6">{children}</main>
      <BottomNav />
    </>
  );
}
