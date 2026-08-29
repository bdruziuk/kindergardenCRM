CREATE TYPE "public"."color_theme" AS ENUM('green', 'blue', 'red', 'yellow');--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "theme" "color_theme";--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "theme_by_owner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "theme" "color_theme";