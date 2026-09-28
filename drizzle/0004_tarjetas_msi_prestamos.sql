CREATE TYPE "public"."amortization_method" AS ENUM('frances');--> statement-breakpoint
CREATE TYPE "public"."loan_row_kind" AS ENUM('cuota', 'abono');--> statement-breakpoint
CREATE TYPE "public"."loan_row_status" AS ENUM('pendiente', 'pagado', 'pagado_previo');--> statement-breakpoint
CREATE TYPE "public"."periodicity" AS ENUM('mensual', 'quincenal', 'semanal');--> statement-breakpoint
ALTER TYPE "public"."tx_kind" ADD VALUE 'compra_msi';--> statement-breakpoint
CREATE TABLE "installment_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_account_id" uuid NOT NULL,
	"description" text NOT NULL,
	"category_id" uuid,
	"principal" bigint NOT NULL,
	"months" smallint NOT NULL,
	"with_interest" boolean DEFAULT false NOT NULL,
	"annual_rate_bp" integer DEFAULT 0 NOT NULL,
	"iva_pct" smallint DEFAULT 0 NOT NULL,
	"purchase_date" date NOT NULL,
	"first_due_date" date NOT NULL,
	"paid_before" smallint DEFAULT 0 NOT NULL,
	"transaction_id" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "msi_months_chk" CHECK ("installment_purchases"."months" between 1 and 60),
	CONSTRAINT "msi_paid_before_chk" CHECK ("installment_purchases"."paid_before" >= 0 and "installment_purchases"."paid_before" < "installment_purchases"."months"),
	CONSTRAINT "msi_principal_chk" CHECK ("installment_purchases"."principal" > 0)
);
--> statement-breakpoint
CREATE TABLE "loan_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "loan_row_kind" DEFAULT 'cuota' NOT NULL,
	"number" smallint NOT NULL,
	"due_date" date NOT NULL,
	"payment" bigint NOT NULL,
	"capital" bigint NOT NULL,
	"interest" bigint NOT NULL,
	"iva" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"status" "loan_row_status" DEFAULT 'pendiente' NOT NULL,
	"paid_date" date,
	"capital_tx_id" uuid,
	"interest_tx_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"pay_from_account_id" uuid,
	"name" text NOT NULL,
	"informal" boolean DEFAULT false NOT NULL,
	"principal" bigint NOT NULL,
	"annual_rate_bp" integer DEFAULT 0 NOT NULL,
	"iva_pct" smallint DEFAULT 0 NOT NULL,
	"periodicity" "periodicity" NOT NULL,
	"n_payments" smallint NOT NULL,
	"first_payment_date" date NOT NULL,
	"method" "amortization_method" DEFAULT 'frances' NOT NULL,
	"opening_fee" bigint,
	"cat_bp" integer,
	"start_balance" bigint NOT NULL,
	"paid_before" smallint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loans_principal_chk" CHECK ("loans"."principal" > 0),
	CONSTRAINT "loans_n_chk" CHECK ("loans"."n_payments" between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "interest_rate_bp" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "annual_fee_item_id" uuid;--> statement-breakpoint
ALTER TABLE "installment_purchases" ADD CONSTRAINT "installment_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_purchases" ADD CONSTRAINT "installment_purchases_card_account_id_accounts_id_fk" FOREIGN KEY ("card_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_purchases" ADD CONSTRAINT "installment_purchases_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_purchases" ADD CONSTRAINT "installment_purchases_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_capital_tx_id_transactions_id_fk" FOREIGN KEY ("capital_tx_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_interest_tx_id_transactions_id_fk" FOREIGN KEY ("interest_tx_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_pay_from_account_id_accounts_id_fk" FOREIGN KEY ("pay_from_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "msi_user_idx" ON "installment_purchases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "msi_card_idx" ON "installment_purchases" USING btree ("card_account_id");--> statement-breakpoint
CREATE INDEX "loan_payments_loan_idx" ON "loan_payments" USING btree ("loan_id","due_date");--> statement-breakpoint
CREATE INDEX "loan_payments_user_idx" ON "loan_payments" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "loan_payments_cuota_uq" ON "loan_payments" USING btree ("loan_id","number") WHERE "loan_payments"."kind" = 'cuota';--> statement-breakpoint
CREATE INDEX "loans_user_idx" ON "loans" USING btree ("user_id");