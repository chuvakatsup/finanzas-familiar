ALTER TABLE "accounts" ADD COLUMN "annual_fee" bigint;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "annual_fee_iva" boolean DEFAULT true NOT NULL;