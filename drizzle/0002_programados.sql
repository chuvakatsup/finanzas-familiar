CREATE TYPE "public"."frequency" AS ENUM('semanal', 'catorcenal', 'quincenal', 'mensual', 'bimestral', 'anual', 'unica');--> statement-breakpoint
CREATE TYPE "public"."occurrence_status" AS ENUM('confirmado', 'omitido');--> statement-breakpoint
CREATE TYPE "public"."schedule_kind" AS ENUM('ingreso', 'pago');--> statement-breakpoint
CREATE TABLE "scheduled_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "schedule_kind" NOT NULL,
	"name" text NOT NULL,
	"amount" bigint NOT NULL,
	"amount_is_estimate" boolean DEFAULT false NOT NULL,
	"frequency" "frequency" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"day1" smallint,
	"day2" smallint,
	"account_id" uuid NOT NULL,
	"category_id" uuid,
	"auto_register" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_amount_chk" CHECK ("scheduled_items"."amount" > 0),
	CONSTRAINT "scheduled_day1_chk" CHECK ("scheduled_items"."day1" is null or "scheduled_items"."day1" between 1 and 31),
	CONSTRAINT "scheduled_day2_chk" CHECK ("scheduled_items"."day2" is null or "scheduled_items"."day2" between 1 and 31),
	CONSTRAINT "scheduled_dates_chk" CHECK ("scheduled_items"."end_date" is null or "scheduled_items"."end_date" >= "scheduled_items"."start_date")
);
--> statement-breakpoint
CREATE TABLE "scheduled_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"status" "occurrence_status" NOT NULL,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_items" ADD CONSTRAINT "scheduled_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_items" ADD CONSTRAINT "scheduled_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_items" ADD CONSTRAINT "scheduled_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_occurrences" ADD CONSTRAINT "scheduled_occurrences_item_id_scheduled_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."scheduled_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_occurrences" ADD CONSTRAINT "scheduled_occurrences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_occurrences" ADD CONSTRAINT "scheduled_occurrences_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_user_idx" ON "scheduled_items" USING btree ("user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "occurrence_item_date_uq" ON "scheduled_occurrences" USING btree ("item_id","due_date");--> statement-breakpoint
CREATE INDEX "occurrence_user_idx" ON "scheduled_occurrences" USING btree ("user_id","due_date");