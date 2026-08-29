CREATE TABLE "invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" DEFAULT 'manager' NOT NULL,
	"branch_id" integer,
	"invited_by" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_invites_token" ON "invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_invites_email" ON "invites" USING btree ("email");