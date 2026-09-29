import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/server/db";
import { serverEnv } from "@/server/env";
import { runDailyReminders } from "@/server/services/reminders";

export const dynamic = "force-dynamic";

function authorized(req: Request) {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * La llama el servicio "cron" (red interna de Docker) una vez al día. Protegida por CRON_SECRET;
 * Nginx además la bloquea desde fuera (ver deploy/nginx).
 */
export async function POST(req: Request) {
  if (!authorized(req)) return new Response("No autorizado", { status: 401 });
  const result = await runDailyReminders(getDb());
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
