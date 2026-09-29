CREATE TYPE "public"."support_applied" AS ENUM('ninguno', 'tarjeta', 'cuota', 'abono');--> statement-breakpoint
CREATE TYPE "public"."support_purpose" AS ENUM('general', 'deuda');--> statement-breakpoint
CREATE TYPE "public"."support_status" AS ENUM('enviado', 'recibido', 'cancelado');--> statement-breakpoint
CREATE TABLE "support_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"frequency" "frequency" NOT NULL,
	"start_date" date NOT NULL,
	"day1" smallint,
	"day2" smallint,
	"from_account_id" uuid NOT NULL,
	"purpose" "support_purpose" DEFAULT 'general' NOT NULL,
	"note" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_schedules_amount_chk" CHECK ("support_schedules"."amount" > 0),
	CONSTRAINT "support_schedules_people_chk" CHECK ("support_schedules"."sender_id" <> "support_schedules"."recipient_id")
);
--> statement-breakpoint
CREATE TABLE "support_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"date" date NOT NULL,
	"note" text,
	"purpose" "support_purpose" DEFAULT 'general' NOT NULL,
	"status" "support_status" DEFAULT 'enviado' NOT NULL,
	"sender_tx_id" uuid,
	"recipient_tx_id" uuid,
	"applied_kind" "support_applied" DEFAULT 'ninguno' NOT NULL,
	"applied_tx_id" uuid,
	"applied_loan_id" uuid,
	"snoozed_until" date,
	"schedule_id" uuid,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_amount_chk" CHECK ("support_transfers"."amount" > 0),
	CONSTRAINT "support_people_chk" CHECK ("support_transfers"."sender_id" <> "support_transfers"."recipient_id")
);
--> statement-breakpoint
ALTER TABLE "support_schedules" ADD CONSTRAINT "support_schedules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_schedules" ADD CONSTRAINT "support_schedules_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_schedules" ADD CONSTRAINT "support_schedules_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_schedules" ADD CONSTRAINT "support_schedules_from_account_id_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_transfers" ADD CONSTRAINT "support_transfers_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_transfers" ADD CONSTRAINT "support_transfers_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_transfers" ADD CONSTRAINT "support_transfers_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_transfers" ADD CONSTRAINT "support_transfers_sender_tx_id_transactions_id_fk" FOREIGN KEY ("sender_tx_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_transfers" ADD CONSTRAINT "support_transfers_recipient_tx_id_transactions_id_fk" FOREIGN KEY ("recipient_tx_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_transfers" ADD CONSTRAINT "support_transfers_applied_tx_id_transactions_id_fk" FOREIGN KEY ("applied_tx_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_transfers" ADD CONSTRAINT "support_transfers_applied_loan_id_loans_id_fk" FOREIGN KEY ("applied_loan_id") REFERENCES "public"."loans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_transfers" ADD CONSTRAINT "support_transfers_schedule_id_support_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."support_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_schedules_sender_idx" ON "support_schedules" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "support_schedules_recipient_idx" ON "support_schedules" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "support_sender_idx" ON "support_transfers" USING btree ("sender_id","date");--> statement-breakpoint
CREATE INDEX "support_recipient_idx" ON "support_transfers" USING btree ("recipient_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "support_schedule_date_uq" ON "support_transfers" USING btree ("schedule_id","date") WHERE "support_transfers"."schedule_id" is not null;