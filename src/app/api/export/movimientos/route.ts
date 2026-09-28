import { getDb } from "@/server/db";
import { getCurrentUser } from "@/server/auth/current";
import { listTransactions } from "@/server/services/transactions";
import { centsToInput } from "@/domain/money";
import { TX_KIND_INFO, txDirection } from "@/domain/transactions";
import { todayIso } from "@/domain/dates";

export const dynamic = "force-dynamic";

/** Escapa un valor para CSV (y evita inyección de fórmulas al abrir en Excel). */
function cell(value: string | null | undefined): string {
  let v = value ?? "";
  // Los montos ("-450.50") se dejan tal cual; otro texto que empiece como fórmula se neutraliza.
  if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+\.\d{2}$/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Descarga todos mis movimientos en CSV (se abre en Excel o Google Sheets). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Inicia sesión para descargar tus datos.", { status: 401 });

  const rows = await listTransactions(getDb(), user, { limit: 100_000 });
  const header = ["Fecha", "Tipo", "Monto", "Categoría", "Sale de", "Entra a", "Nota"];
  const lines = rows
    .slice()
    .reverse()
    .map((r) => {
      const sign = txDirection(r.kind) === "sale" ? "-" : "";
      return [
        r.date,
        TX_KIND_INFO[r.kind].label,
        `${sign}${centsToInput(r.amount)}`,
        r.categoryName,
        r.fromAccountName,
        r.toAccountName,
        r.note,
      ]
        .map((v) => cell(v))
        .join(",");
    });
  // BOM para que Excel reconozca los acentos.
  const body = `﻿${[header.join(","), ...lines].join("\r\n")}\r\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mis-movimientos-${todayIso()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
