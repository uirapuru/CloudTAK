CREATE TABLE "profile_overlay_favorites" (
	"username" text NOT NULL,
	"key" text NOT NULL,
	"created" timestamp with time zone DEFAULT Now() NOT NULL,
	CONSTRAINT "profile_overlay_favorites_username_key_pk" PRIMARY KEY("username","key")
);
--> statement-breakpoint
ALTER TABLE "profile_overlay_favorites" ADD CONSTRAINT "profile_overlay_favorites_username_profile_username_fk" FOREIGN KEY ("username") REFERENCES "public"."profile"("username") ON DELETE no action ON UPDATE no action;