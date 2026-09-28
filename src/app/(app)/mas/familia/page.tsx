import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current";
import { revokeInvitationAction } from "@/server/actions/family";
import { getHousehold, listMembers } from "@/server/services/household";
import { listPendingInvitations } from "@/server/services/invitations";
import { Card, PageTitle } from "@/components/ui";
import { InviteForm, ResetLinkButton } from "./family-forms";

export const metadata: Metadata = { title: "Mi familia" };

const dateFmt = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mazatlan",
  day: "numeric",
  month: "long",
});

export default async function FamilyPage() {
  const actor = await requireUser();
  const db = getDb();
  const isAdmin = actor.role === "admin";
  const [household, members, pending] = await Promise.all([
    getHousehold(db, actor),
    listMembers(db, actor),
    isAdmin ? listPendingInvitations(db, actor) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageTitle subtitle={household?.name}>Mi familia</PageTitle>

      <Card className="mb-5">
        <h2 className="mb-3 text-2xl font-bold">Personas</h2>
        <p className="mb-4 text-base text-muted">
          Cada quien ve solo sus propias cuentas. Aquí solo aparecen los nombres.
        </p>
        <ul className="flex flex-col divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xl font-semibold">{m.name}</span>
                {m.isMe && <span className="text-base text-muted">(tú)</span>}
                {m.role === "admin" && (
                  <span className="rounded-full bg-surface-2 px-2 text-sm font-semibold">Administra</span>
                )}
              </div>
              {m.email && <span className="break-all text-base text-muted">{m.email}</span>}
              {isAdmin && !m.isMe && <ResetLinkButton userId={m.id} name={m.name} />}
            </li>
          ))}
        </ul>
      </Card>

      {isAdmin && (
        <Card className="mb-5">
          <h2 className="mb-3 text-2xl font-bold">Invitar a alguien</h2>
          <InviteForm />
          {pending.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 text-xl font-semibold">Invitaciones sin usar</h3>
              <ul className="flex flex-col gap-3">
                {pending.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 p-3"
                  >
                    <span className="text-lg">
                      {inv.suggestedName || "Sin nombre"}
                      <span className="block text-base text-muted">
                        Vence el {dateFmt.format(inv.expiresAt)}
                      </span>
                    </span>
                    <form action={revokeInvitationAction}>
                      <input type="hidden" name="id" value={inv.id} />
                      <button
                        type="submit"
                        className="min-h-12 rounded-xl border-2 border-danger px-4 font-semibold text-danger"
                      >
                        Cancelar
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </>
  );
}
