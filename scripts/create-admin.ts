/**
 * Alta del grupo familiar y su administrador. Imprime un enlace (24 h) para que el admin
 * cree su contraseña desde el celular; así ninguna contraseña pasa por la terminal.
 *
 *   pnpm admin:create --familia "Familia Pérez" --nombre "Daniel" --correo daniel@correo.com
 *   docker compose exec app node scripts/create-admin.mjs --familia ... (en producción)
 */
import { parseArgs } from "node:util";
import { closeDb, getDb } from "@/server/db";
import { serverEnv } from "@/server/env";
import { createHouseholdWithAdmin } from "@/server/services/household";

const { values } = parseArgs({
  options: {
    familia: { type: "string" },
    nombre: { type: "string" },
    correo: { type: "string" },
  },
});

if (!values.familia || !values.nombre || !values.correo) {
  console.error('Uso: --familia "Familia Pérez" --nombre "Daniel" --correo daniel@correo.com');
  process.exit(1);
}

try {
  const result = await getDb().transaction((tx) =>
    createHouseholdWithAdmin(tx, {
      householdName: values.familia!,
      adminName: values.nombre!,
      adminEmail: values.correo!,
    }),
  );
  const link = new URL(`/restablecer/${result.resetToken}`, serverEnv().APP_URL).toString();
  console.log(`✔ Familia "${result.household.name}" creada. Admin: ${result.admin.email}`);
  console.log(`\nAbre este enlace para crear la contraseña (vence ${result.resetExpiresAt.toISOString()}):\n\n  ${link}\n`);
} catch (e) {
  console.error("✖", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
