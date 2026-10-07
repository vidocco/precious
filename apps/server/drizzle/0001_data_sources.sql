CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"base_url" text NOT NULL,
	"auth" jsonb NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secrets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rate_limit" jsonb NOT NULL,
	"cache_seconds" integer DEFAULT 86400 NOT NULL,
	"user_agent" text,
	"last_call" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"method" text DEFAULT 'GET' NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"query" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body" jsonb NOT NULL,
	"graphql" jsonb NOT NULL,
	"format" text DEFAULT 'auto' NOT NULL,
	"extract" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cache_seconds" integer,
	"sample" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "http_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"status" integer NOT NULL,
	"content_type" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "endpoints_source_key_idx" ON "endpoints" USING btree ("source_id","key");