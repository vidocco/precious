CREATE TABLE "computed_state" (
	"item_id" uuid NOT NULL,
	"field" text NOT NULL,
	"schedule_key" text NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "computed_state_item_id_field_pk" PRIMARY KEY("item_id","field")
);
--> statement-breakpoint
CREATE TABLE "computed_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "templates" ALTER COLUMN "bindings" SET DEFAULT '{"search":[],"steps":[],"computed":[]}'::jsonb;--> statement-breakpoint
ALTER TABLE "computed_state" ADD CONSTRAINT "computed_state_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computed_values" ADD CONSTRAINT "computed_values_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "computed_state_next_idx" ON "computed_state" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "computed_values_item_idx" ON "computed_values" USING btree ("item_id","field","at");--> statement-breakpoint
UPDATE "templates" SET "bindings" = "bindings" || '{"computed":[]}'::jsonb WHERE NOT ("bindings" ? 'computed');
