import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ACCOUNT_KINDS } from "@/domain/accounts";
import { CATEGORY_KINDS } from "@/domain/categories";
import { TX_KINDS, TX_ORIGINS } from "@/domain/transactions";
import { FREQUENCIES } from "@/domain/recurrence";

// Convención: dinero SIEMPRE en centavos enteros (bigint, mode "number").
// Fechas sin hora como `date`; instantes como timestamptz.

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const userRole = pgEnum("user_role", ["admin", "miembro"]);

export type UserPrefs = {
  /** Tamaño de letra (se suma al tamaño del sistema). */
  letra?: "normal" | "grande" | "muy-grande";
  tema?: "sistema" | "claro" | "oscuro";
  /** % de los ingresos bajo el cual el semáforo se pone amarillo (10 por defecto). */
  umbralAmarillo?: number;
  /** Ya vio (o saltó) el asistente de primer uso. */
  bienvenidaHecha?: boolean;
};

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    // Siempre en minúsculas (se normaliza en código).
    email: text("email").notNull(),
    // Null = aún no define contraseña (admin recién creado por CLI).
    passwordHash: text("password_hash"),
    role: userRole("role").notNull().default("miembro"),
    prefs: jsonb("prefs").$type<UserPrefs>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email), index("users_household_idx").on(t.householdId)],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 (hex) del token de la cookie; el token en claro nunca se guarda.
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    suggestedName: text("suggested_name"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedBy: uuid("used_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("invitations_token_uq").on(t.tokenHash),
    index("invitations_household_idx").on(t.householdId),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    // Null = creado desde la línea de comandos (alta del primer admin).
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("password_reset_token_uq").on(t.tokenHash)],
);

/** Intentos de autenticación, para limitar fuerza bruta (login y enlaces con token). */
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(), // 'login-email' | 'login-ip' | 'token-ip'
    key: text("key").notNull(),
    success: boolean("success").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("auth_attempts_lookup_idx").on(t.kind, t.key, t.createdAt)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    householdId: uuid("household_id").references(() => households.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_household_idx").on(t.householdId, t.createdAt),
    index("audit_entity_idx").on(t.entity, t.entityId),
  ],
);


// ---------------------------------------------------------------------------
// Fase 2: cuentas, categorías y movimientos
// ---------------------------------------------------------------------------

const money = (name: string) => bigint(name, { mode: "number" });

export const accountKind = pgEnum("account_kind", ACCOUNT_KINDS);
export const categoryKind = pgEnum("category_kind", CATEGORY_KINDS);
export const txKind = pgEnum("tx_kind", TX_KINDS);
export const txOrigin = pgEnum("tx_origin", TX_ORIGINS);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: accountKind("kind").notNull(),
    name: text("name").notNull(),
    // Solo últimos 4 dígitos, opcional. Nunca el número completo.
    last4: text("last4"),
    // Saldo al darla de alta (negativo = deuda). El saldo actual se CALCULA con los movimientos.
    openingBalance: money("opening_balance").notNull().default(0),
    creditLimit: money("credit_limit"),
    statementDay: smallint("statement_day"),
    paymentDueDay: smallint("payment_due_day"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("accounts_user_idx").on(t.userId),
    check("accounts_last4_chk", sql`${t.last4} is null or ${t.last4} ~ '^[0-9]{4}$'`),
    check("accounts_statement_day_chk", sql`${t.statementDay} is null or ${t.statementDay} between 1 and 31`),
    check("accounts_due_day_chk", sql`${t.paymentDueDay} is null or ${t.paymentDueDay} between 1 and 31`),
    check("accounts_limit_chk", sql`${t.creditLimit} is null or ${t.creditLimit} >= 0`),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: categoryKind("kind").notNull(),
    name: text("name").notNull(),
    icon: text("icon").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("categories_user_idx").on(t.userId, t.kind)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: txKind("kind").notNull(),
    // Siempre positivo; la dirección la dan from/to.
    amount: money("amount").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    // De dónde sale el dinero / a dónde entra (uno o ambos).
    fromAccountId: uuid("from_account_id").references(() => accounts.id, { onDelete: "restrict" }),
    toAccountId: uuid("to_account_id").references(() => accounts.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "restrict" }),
    note: text("note"),
    origin: txOrigin("origin").notNull().default("manual"),
    // Id del registro que lo generó (pago recurrente, MSI, préstamo, apoyo).
    sourceId: uuid("source_id"),
    // Borrado suave: permite "Deshacer".
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tx_user_date_idx").on(t.userId, t.date),
    index("tx_from_idx").on(t.fromAccountId),
    index("tx_to_idx").on(t.toAccountId),
    check("tx_amount_positive_chk", sql`${t.amount} > 0`),
    check("tx_has_account_chk", sql`${t.fromAccountId} is not null or ${t.toAccountId} is not null`),
    check("tx_distinct_accounts_chk", sql`${t.fromAccountId} is distinct from ${t.toAccountId}`),
  ],
);

// ---------------------------------------------------------------------------
// Fase 3: ingresos fijos y pagos recurrentes ("programados")
// ---------------------------------------------------------------------------

export const scheduleKind = pgEnum("schedule_kind", ["ingreso", "pago"]);
export const frequency = pgEnum("frequency", FREQUENCIES);
export const occurrenceStatus = pgEnum("occurrence_status", ["confirmado", "omitido"]);

export const scheduledItems = pgTable(
  "scheduled_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: scheduleKind("kind").notNull(),
    name: text("name").notNull(),
    amount: money("amount").notNull(),
    // true = el monto cambia (luz, agua): se usa como estimado y se ajusta al confirmar.
    amountIsEstimate: boolean("amount_is_estimate").notNull().default(false),
    frequency: frequency("frequency").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    day1: smallint("day1"),
    day2: smallint("day2"),
    // Cuenta destino (ingreso) o de cargo (pago).
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "restrict" }),
    // Domiciliado / depósito automático: se registra solo al llegar la fecha.
    autoRegister: boolean("auto_register").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("scheduled_user_idx").on(t.userId, t.kind),
    check("scheduled_amount_chk", sql`${t.amount} > 0`),
    check("scheduled_day1_chk", sql`${t.day1} is null or ${t.day1} between 1 and 31`),
    check("scheduled_day2_chk", sql`${t.day2} is null or ${t.day2} between 1 and 31`),
    check("scheduled_dates_chk", sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
  ],
);

/**
 * Lo que pasó con cada fecha de un programado. Si no hay renglón, la fecha está pendiente.
 * "confirmado" con movimiento borrado se considera pendiente otra vez.
 */
export const scheduledOccurrences = pgTable(
  "scheduled_occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => scheduledItems.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    status: occurrenceStatus("status").notNull(),
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("occurrence_item_date_uq").on(t.itemId, t.dueDate),
    index("occurrence_user_idx").on(t.userId, t.dueDate),
  ],
);

// ---------------------------------------------------------------------------
// Fase 4: presupuesto de gasto variable (general y opcional por categoría)
// ---------------------------------------------------------------------------

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // null = presupuesto general del mes.
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "cascade" }),
    amount: money("amount").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("budgets_general_uq").on(t.userId).where(sql`${t.categoryId} is null`),
    uniqueIndex("budgets_category_uq").on(t.userId, t.categoryId).where(sql`${t.categoryId} is not null`),
    check("budgets_amount_chk", sql`${t.amount} > 0`),
  ],
);
