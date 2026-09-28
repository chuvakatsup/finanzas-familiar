import { getDb } from "@/server/db";
import { getCurrentUser } from "@/server/auth/current";
import { AuthzError } from "@/server/authz";
import { getLoan } from "@/server/services/loans";
import { centsToInput } from "@/domain/money";

export const dynamic = "force-dynamic";

const STATUS = { pagado_previo: "Pagado antes", pagado: "Pagado", pendiente: "Por pagar" } as const;

/** Tabla de amortización en CSV (para Excel). */
export async function GET(_req: Request, ctx: RouteContext<"/api/export/prestamo/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Inicia sesión para descargar.", { status: 401 });
  const { id } = await ctx.params;
  try {
    const { loan, rows } = await getLoan(getDb(), user, id);
    const header = ["Número", "Tipo", "Fecha", "Pago", "Capital", "Interés", "IVA", "Saldo después", "Estado"];
    const lines = rows.map((r) =>
      [
        r.number,
        r.kind === "abono" ? "Abono a capital" : "Cuota",
        r.dueDate,
        centsToInput(r.payment),
        centsToInput(r.capital),
        centsToInput(r.interest),
        centsToInput(r.iva),
        centsToInput(r.balanceAfter),
        STATUS[r.status],
      ].join(","),
    );
    const safeName = loan.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "prestamo";
    return new Response(`﻿${[header.join(","), ...lines].join("\r\n")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tabla-${encodeURIComponent(safeName)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AuthzError) return new Response("No encontrado.", { status: 404 });
    throw e;
  }
}
