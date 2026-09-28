CREATE TYPE "public"."account_kind" AS ENUM('efectivo', 'debito', 'credito', 'ahorro', 'prestamo');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('gasto', 'ingreso');--> statement-breakpoint
CREATE TYPE "public"."tx_kind" AS ENUM('gasto', 'ingreso', 'transferencia', 'pago_tarjeta', 'pago_prestamo', 'apoyo_enviado', 'apoyo_recibido', 'ajuste');--> statement-breakpoint
CREATE TYPE "public"."tx_origin" AS ENUM('manual', 'recurrente', 'msi', 'prestamo', 'apoyo');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "account_kind" NOT NULL,
	"name" text NOT NULL,
	"last4" text,
	"opening_balance" bigint DEFAULT 0 NOT NULL,
	"credit_limit" bigint,
	"statement_day" smallint,
	"payment_due_day" smallint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_last4_chk" CHECK ("accounts"."last4" is null or "accounts"."last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "accounts_statement_day_chk" CHECK ("accounts"."statement_day" is null or "accounts"."statement_day" between 1 and 31),
	CONSTRAINT "accounts_due_day_chk" CHECK ("accounts"."payment_due_day" is null or "accounts"."payment_due_day" between 1 and 31),
	CONSTRAINT "accounts_limit_chk" CHECK ("accounts"."credit_limit" is null or "accounts"."credit_limit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "category_kind" NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "tx_kind" NOT NULL,
	"amount" bigint NOT NULL,
	"date" date NOT NULL,
	"from_account_id" uuid,
	"to_account_id" uuid,
	"category_id" uuid,
	"note" text,
	"origin" "tx_origin" DEFAULT 'manual' NOT NULL,
	"source_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tx_amount_positive_chk" CHECK ("transactions"."amount" > 0),
	CONSTRAINT "tx_has_account_chk" CHECK ("transactions"."from_account_id" is not null or "transactions"."to_account_id" is not null),
	CONSTRAINT "tx_distinct_accounts_chk" CHECK ("transactions"."from_account_id" is distinct from "transactions"."to_account_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_from_account_id_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "categories_user_idx" ON "categories" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "tx_user_date_idx" ON "transactions" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "tx_from_idx" ON "transactions" USING btree ("from_account_id");--> statement-breakpoint
CREATE INDEX "tx_to_idx" ON "transactions" USING btree ("to_account_id");