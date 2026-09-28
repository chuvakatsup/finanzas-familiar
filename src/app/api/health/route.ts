import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

/** Usado por el healthcheck de Docker y el monitor externo. No expone detalles. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
