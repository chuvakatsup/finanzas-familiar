import { hash } from "@node-rs/argon2";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { DEFAULT_CATEGORIES } from "../../src/domain/categories";
import { E2E_USERS } from "./users";

/** BD de pruebas limpia con dos personas: Daniel (admin) y Mamá, con categorías y cuentas. */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://finanzas:finanzas@127.0.0.1:5434/finanzas_test";
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
  await sql`truncate table scheduled_occurrences, scheduled_items, transactions, categories, accounts, audit_log, auth_attempts, password_reset_tokens, invitations, sessions, users, households restart identity cascade`;
  const [h] = await sql`insert into households (name) values ('Familia E2E') returning id`;
  for (const u of Object.values(E2E_USERS)) {
    const [user] = await sql`insert into users (household_id, name, email, password_hash, role)
              values (${h.id}, ${u.name}, ${u.email}, ${await hash(u.password)}, ${u.role}) returning id`;
    for (const kind of ["gasto", "ingreso"] as const) {
      for (const [i, c] of DEFAULT_CATEGORIES[kind].entries()) {
        await sql`insert into categories (user_id, kind, name, icon, sort_order)
                  values (${user.id}, ${kind}, ${c.name}, ${c.icon}, ${i})`;
      }
    }
    await sql`insert into accounts (user_id, kind, name, opening_balance, sort_order) values
      (${user.id}, 'efectivo', 'Efectivo', 100000, 0),
      (${user.id}, 'debito', 'Banco', 500000, 1),
      (${user.id}, 'credito', 'Tarjeta', 0, 2)`;
  }
  await sql.end();
}
