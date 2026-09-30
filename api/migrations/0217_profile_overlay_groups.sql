CREATE TABLE IF NOT EXISTS "profile_overlay_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"name" text NOT NULL,
	"pos" integer DEFAULT 0 NOT NULL,
	"collapsed" boolean DEFAULT false NOT NULL,
	"created" timestamp with time zone DEFAULT Now() NOT NULL,
	"updated" timestamp with time zone DEFAULT Now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_overlays" ADD COLUMN IF NOT EXISTS "group_id" integer;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "profile_overlay_groups" ADD CONSTRAINT "profile_overlay_groups_username_profile_username_fk" FOREIGN KEY ("username") REFERENCES "public"."profile"("username") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "profile_overlays" ADD CONSTRAINT "profile_overlays_group_id_profile_overlay_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."profile_overlay_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
