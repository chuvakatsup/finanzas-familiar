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
import { AMORTIZATION_METHODS, PERIODICITIES } from "@/domain/amortization";

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
  /** Los apoyos que me enviaron y aún no confirmo cuentan como ingreso esperado (true por defecto). */
  apoyosPendientesCuentan?: boolean;
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
    // Crédito: tasa anual ordinaria en puntos base (24.5% = 2450), para estimar intereses.
    interestRateBp: integer("interest_rate_bp"),
    // Crédito: pago programado que representa la anualidad.
    annualFeeItemId: uuid("annual_fee_item_id"),
    annualFee: money("annual_fee"),
    annualFeeIva: boolean("annual_fee_iva").notNull().default(true),
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

// ---------------------------------------------------------------------------
// Fase 5: compras a meses (con y sin intereses)
// ---------------------------------------------------------------------------

export const installmentPurchases = pgTable(
  "installment_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardAccountId: uuid("card_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    description: text("description").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "restrict" }),
    // Precio de la compra (sin intereses).
    principal: money("principal").notNull(),
    months: smallint("months").notNull(),
    withInterest: boolean("with_interest").notNull().default(false),
    annualRateBp: integer("annual_rate_bp").notNull().default(0),
    ivaPct: smallint("iva_pct").notNull().default(0),
    purchaseDate: date("purchase_date", { mode: "string" }).notNull(),
    firstDueDate: date("first_due_date", { mode: "string" }).notNull(),
    // Compra que ya venía corriendo: mensualidades pagadas antes de usar la app (no afectan meses pasados).
    paidBefore: smallint("paid_before").notNull().default(0),
    // Movimiento que subió la deuda de la tarjeta (solo lo que faltaba por pagar).
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("msi_user_idx").on(t.userId),
    index("msi_card_idx").on(t.cardAccountId),
    check("msi_months_chk", sql`${t.months} between 1 and 60`),
    check("msi_paid_before_chk", sql`${t.paidBefore} >= 0 and ${t.paidBefore} < ${t.months}`),
    check("msi_principal_chk", sql`${t.principal} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Fase 6: préstamos y su tabla de amortización
// ---------------------------------------------------------------------------

export const periodicity = pgEnum("periodicity", PERIODICITIES);
export const amortizationMethod = pgEnum("amortization_method", AMORTIZATION_METHODS);
export const loanRowStatus = pgEnum("loan_row_status", ["pendiente", "pagado", "pagado_previo"]);
export const loanRowKind = pgEnum("loan_row_kind", ["cuota", "abono"]);

export const loans = pgTable(
  "loans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Cuenta tipo "prestamo" cuyo saldo (negativo) es el capital que se debe.
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    // Cuenta desde donde normalmente se paga.
    payFromAccountId: uuid("pay_from_account_id").references(() => accounts.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    informal: boolean("informal").notNull().default(false),
    principal: money("principal").notNull(),
    annualRateBp: integer("annual_rate_bp").notNull().default(0),
    ivaPct: smallint("iva_pct").notNull().default(0),
    periodicity: periodicity("periodicity").notNull(),
    nPayments: smallint("n_payments").notNull(),
    firstPaymentDate: date("first_payment_date", { mode: "string" }).notNull(),
    method: amortizationMethod("method").notNull().default("frances"),
    openingFee: money("opening_fee"),
    // CAT: solo informativo (lo reporta el banco), en puntos base.
    catBp: integer("cat_bp"),
    // Capital que se debía al darlo de alta (después de los pagos previos).
    startBalance: money("start_balance").notNull(),
    paidBefore: smallint("paid_before").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("loans_user_idx").on(t.userId),
    check("loans_principal_chk", sql`${t.principal} > 0`),
    check("loans_n_chk", sql`${t.nPayments} between 1 and 1000`),
  ],
);

export const loanPayments = pgTable(
  "loan_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: loanRowKind("kind").notNull().default("cuota"),
    number: smallint("number").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    payment: money("payment").notNull(),
    capital: money("capital").notNull(),
    interest: money("interest").notNull(),
    iva: money("iva").notNull(),
    balanceAfter: money("balance_after").notNull(),
    status: loanRowStatus("status").notNull().default("pendiente"),
    paidDate: date("paid_date", { mode: "string" }),
    capitalTxId: uuid("capital_tx_id").references(() => transactions.id, { onDelete: "set null" }),
    interestTxId: uuid("interest_tx_id").references(() => transactions.id, { onDelete: "set null" }),
    // Cuándo se registró el pago/abono en la app (para deshacer en orden).
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("loan_payments_loan_idx").on(t.loanId, t.dueDate),
    index("loan_payments_user_idx").on(t.userId, t.dueDate),
    uniqueIndex("loan_payments_cuota_uq").on(t.loanId, t.number).where(sql`${t.kind} = 'cuota'`),
  ],
);

// ---------------------------------------------------------------------------
// Fase 7: apoyos familiares
// ---------------------------------------------------------------------------

export const supportStatus = pgEnum("support_status", ["enviado", "recibido", "cancelado"]);
export const supportPurpose = pgEnum("support_purpose", ["general", "deuda"]);
/** Cómo lo aplicó quien lo recibió (si era para una deuda). */
export const supportApplied = pgEnum("support_applied", ["ninguno", "tarjeta", "cuota", "abono"]);

/** Apoyos recurrentes (cada semana/quincena/mes): generan un apoyo "enviado" en cada fecha. */
export const supportSchedules = pgTable(
  "support_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: money("amount").notNull(),
    frequency: frequency("frequency").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    day1: smallint("day1"),
    day2: smallint("day2"),
    fromAccountId: uuid("from_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    purpose: supportPurpose("purpose").notNull().default("general"),
    note: text("note"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("support_schedules_sender_idx").on(t.senderId),
    index("support_schedules_recipient_idx").on(t.recipientId),
    check("support_schedules_amount_chk", sql`${t.amount} > 0`),
    check("support_schedules_people_chk", sql`${t.senderId} <> ${t.recipientId}`),
  ],
);

export const supportTransfers = pgTable(
  "support_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: money("amount").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    note: text("note"),
    purpose: supportPurpose("purpose").notNull().default("general"),
    status: supportStatus("status").notNull().default("enviado"),
    // Egreso "Apoyo enviado" en la cuenta de quien envía.
    senderTxId: uuid("sender_tx_id").references(() => transactions.id, { onDelete: "set null" }),
    // Ingreso "Apoyo recibido" de quien recibe (al confirmar).
    recipientTxId: uuid("recipient_tx_id").references(() => transactions.id, { onDelete: "set null" }),
    appliedKind: supportApplied("applied_kind").notNull().default("ninguno"),
    // Movimiento con que se aplicó: pago a la tarjeta, o capital de la cuota/abono del préstamo.
    appliedTxId: uuid("applied_tx_id").references(() => transactions.id, { onDelete: "set null" }),
    appliedLoanId: uuid("applied_loan_id").references(() => loans.id, { onDelete: "set null" }),
    // "Todavía no": no se vuelve a preguntar hasta esta fecha.
    snoozedUntil: date("snoozed_until", { mode: "string" }),
    scheduleId: uuid("schedule_id").references(() => supportSchedules.id, { onDelete: "set null" }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("support_sender_idx").on(t.senderId, t.date),
    index("support_recipient_idx").on(t.recipientId, t.status),
    uniqueIndex("support_schedule_date_uq").on(t.scheduleId, t.date).where(sql`${t.scheduleId} is not null`),
    check("support_amount_chk", sql`${t.amount} > 0`),
    check("support_people_chk", sql`${t.senderId} <> ${t.recipientId}`),
  ],
);

// ---------------------------------------------------------------------------
// Fase 8: recordatorios push
// ---------------------------------------------------------------------------

/** Un celular/navegador que aceptó recibir recordatorios. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    failures: smallint("failures").notNull().default(0),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("push_endpoint_uq").on(t.endpoint), index("push_user_idx").on(t.userId)],
);

/** Avisos ya enviados (para no mandar el mismo dos veces). */
export const notificationLog = pgTable(
  "notification_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("notification_user_key_uq").on(t.userId, t.key)],
);

// ---------------------------------------------------------------------------
// Fase 9: gastos compartidos
// ---------------------------------------------------------------------------

/**
 * pendiente → (quien debe: "Ya te pagué") pagado → (dueño: "Sí, me llegó") recibido.
 * rechazado = quien debe dijo "Esto no es mío" (vuelve a contar completo para el dueño).
 */
export const sharedStatus = pgEnum("shared_status", ["pendiente", "pagado", "recibido", "rechazado"]);

/** La parte de un gasto que le toca a otra persona de la familia (una fila por persona). */
export const sharedDebts = pgTable(
  "shared_debts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    // Quien pagó el cargo completo y a quien le deben.
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    debtorId: uuid("debtor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Gasto del dueño que se reparte. Si se borra (suave), la parte deja de contar para todos.
    sourceTxId: uuid("source_tx_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    amount: money("amount").notNull(),
    // Solo si se repartió por porcentaje (50% = 5000), para mostrarlo.
    percentBp: integer("percent_bp"),
    // Fecha del cargo (el mes en que cuenta como compromiso para quien debe).
    date: date("date", { mode: "string" }).notNull(),
    // Qué fue (lo único del cargo que ve quien debe: nunca la cuenta ni la tarjeta del dueño).
    concept: text("concept").notNull(),
    status: sharedStatus("status").notNull().default("pendiente"),
    // Gasto "Tu parte" en la cuenta de quien debe (al decir "Ya te pagué").
    paidTxId: uuid("paid_tx_id").references(() => transactions.id, { onDelete: "set null" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    // Reembolso en la cuenta (o tarjeta) del dueño (al confirmar que le llegó).
    receivedTxId: uuid("received_tx_id").references(() => transactions.id, { onDelete: "set null" }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    // El dueño ya vio el "Esto no es mío" (deja de avisarse).
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shared_tx_debtor_uq").on(t.sourceTxId, t.debtorId),
    index("shared_owner_idx").on(t.ownerId, t.status),
    index("shared_debtor_idx").on(t.debtorId, t.status),
    check("shared_amount_chk", sql`${t.amount} > 0`),
    check("shared_people_chk", sql`${t.ownerId} <> ${t.debtorId}`),
    check("shared_percent_chk", sql`${t.percentBp} is null or ${t.percentBp} between 1 and 10000`),
  ],
);
