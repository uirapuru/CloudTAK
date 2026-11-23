CREATE TABLE "area_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created" timestamp with time zone DEFAULT Now() NOT NULL,
	"updated" timestamp with time zone DEFAULT Now() NOT NULL,
	"username" text NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"error" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"bounds" GEOMETRY(POLYGON, 4326) NOT NULL,
	"layers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assets" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "area_packages_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "area_packages" ADD CONSTRAINT "area_packages_username_profile_username_fk" FOREIGN KEY ("username") REFERENCES "public"."profile"("username") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "area_packages_username_created_idx" ON "area_packages" USING btree ("username","created");