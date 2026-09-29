CREATE TYPE "public"."shared_status" AS ENUM('pendiente', 'pagado', 'recibido', 'rechazado');--> statement-breakpoint
ALTER TYPE "public"."tx_kind" ADD VALUE 'reembolso';--> statement-breakpoint
ALTER TYPE "public"."tx_origin" ADD VALUE 'compartido';--> statement-breakpoint
CREATE TABLE "shared_debts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"debtor_id" uuid NOT NULL,
	"source_tx_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"percent_bp" integer,
	"date" date NOT NULL,
	"concept" text NOT NULL,
	"status" "shared_status" DEFAULT 'pendiente' NOT NULL,
	"paid_tx_id" uuid,
	"paid_at" timestamp with time zone,
	"received_tx_id" uuid,
	"received_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_amount_chk" CHECK ("shared_debts"."amount" > 0),
	CONSTRAINT "shared_people_chk" CHECK ("shared_debts"."owner_id" <> "shared_debts"."debtor_id"),
	CONSTRAINT "shared_percent_chk" CHECK ("shared_debts"."percent_bp" is null or "shared_debts"."percent_bp" between 1 and 10000)
);
--> statement-breakpoint
ALTER TABLE "shared_debts" ADD CONSTRAINT "shared_debts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_debts" ADD CONSTRAINT "shared_debts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_debts" ADD CONSTRAINT "shared_debts_debtor_id_users_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_debts" ADD CONSTRAINT "shared_debts_source_tx_id_transactions_id_fk" FOREIGN KEY ("source_tx_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_debts" ADD CONSTRAINT "shared_debts_paid_tx_id_transactions_id_fk" FOREIGN KEY ("paid_tx_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_debts" ADD CONSTRAINT "shared_debts_received_tx_id_transactions_id_fk" FOREIGN KEY ("received_tx_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shared_tx_debtor_uq" ON "shared_debts" USING btree ("source_tx_id","debtor_id");--> statement-breakpoint
CREATE INDEX "shared_owner_idx" ON "shared_debts" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "shared_debtor_idx" ON "shared_debts" USING btree ("debtor_id","status");