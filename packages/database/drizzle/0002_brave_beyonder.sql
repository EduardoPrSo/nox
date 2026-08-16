ALTER TABLE "ai_usage" ADD COLUMN "input_units" numeric(24, 6);--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "output_units" numeric(24, 6);--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "unit" text;