import {
  bigserial,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Convención: dinero SIEMPRE en centavos enteros (bigint, mode "number").
// Fechas sin hora como `date`; instantes como timestamptz.

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const userRole = pgEnum("user_role", ["admin", "miembro"]);

export type UserPrefs = {
  /** Escala de letra relativa al tamaño del sistema (1 = normal). */
  fontScale?: number;
  theme?: "sistema" | "claro" | "oscuro";
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

