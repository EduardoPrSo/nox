CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;--> statement-breakpoint
CREATE TYPE "public"."ambient_transcript_decision" AS ENUM('PENDING', 'DISCARD', 'KEEP');--> statement-breakpoint
CREATE TYPE "public"."eko_stored_state" AS ENUM('OFF', 'AMBIENT');--> statement-breakpoint
CREATE TYPE "public"."long_term_memory_source" AS ENUM('conversation', 'eko', 'explicit', 'tool', 'vision');--> statement-breakpoint
CREATE TYPE "public"."long_term_memory_type" AS ENUM('FACT', 'EVENT', 'PREFERENCE', 'PLAN', 'LOCATION', 'RELATIONSHIP', 'OBSERVATION');--> statement-breakpoint
CREATE TABLE "ambient_transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"text" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"decision" "ambient_transcript_decision" DEFAULT 'PENDING' NOT NULL,
	"memory_id" uuid,
	"source_timestamp" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eko_device_states" (
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"state" "eko_stored_state" DEFAULT 'OFF' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eko_device_states_user_id_device_id_pk" PRIMARY KEY("user_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "long_term_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"type" "long_term_memory_type" NOT NULL,
	"content" text NOT NULL,
	"importance" numeric(4, 3) NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"source" "long_term_memory_source" NOT NULL,
	"source_timestamp" timestamp with time zone NOT NULL,
	"source_transcript_id" uuid,
	"embedding" "extensions"."vector"(1536) NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "operation" text;--> statement-breakpoint
CREATE INDEX "ambient_transcripts_owner_created_idx" ON "ambient_transcripts" USING btree ("user_id","device_id","created_at");--> statement-breakpoint
CREATE INDEX "ambient_transcripts_expires_idx" ON "ambient_transcripts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "long_term_memories_owner_updated_idx" ON "long_term_memories" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "long_term_memories_owner_source_idx" ON "long_term_memories" USING btree ("user_id","source");--> statement-breakpoint
CREATE INDEX "long_term_memories_expires_idx" ON "long_term_memories" USING btree ("expires_at");
