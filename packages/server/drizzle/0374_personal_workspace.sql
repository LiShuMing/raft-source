CREATE TABLE "personal_artifact_revisions" (
	"artifact_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"content" text NOT NULL,
	"digest" text NOT NULL,
	"source_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_artifact_revisions_artifact_id_revision_pk" PRIMARY KEY("artifact_id","revision")
);
--> statement-breakpoint
CREATE TABLE "personal_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"agent_id" uuid,
	"channel_id" uuid NOT NULL,
	"source_message_id" uuid,
	"title" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"target_channel_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"digest" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"receipt_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"title" text NOT NULL,
	"agent_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_preferences" (
	"server_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_preferences_server_id_user_id_pk" PRIMARY KEY("server_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "personal_resource_revisions" (
	"resource_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_resource_revisions_resource_id_version_pk" PRIMARY KEY("resource_id","version")
);
--> statement-breakpoint
CREATE TABLE "personal_resources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"agent_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"source_message_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_resource_kind" CHECK ("personal_resources"."kind" IN ('memory','skill'))
);
--> statement-breakpoint
CREATE TABLE "personal_routine_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"routine_id" uuid NOT NULL,
	"schedule_version" integer NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"message_id" uuid,
	"instruction" text NOT NULL,
	"error_code" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_routines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instruction" text NOT NULL,
	"schedule" text NOT NULL,
	"time" text NOT NULL,
	"timezone" text NOT NULL,
	"weekday" integer DEFAULT 2 NOT NULL,
	"skill_id" uuid,
	"skill_version" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_artifact_revisions" ADD CONSTRAINT "personal_artifact_revisions_artifact_id_personal_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."personal_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_artifact_revisions" ADD CONSTRAINT "personal_artifact_revisions_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_artifacts" ADD CONSTRAINT "personal_artifacts_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_artifacts" ADD CONSTRAINT "personal_artifacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_artifacts" ADD CONSTRAINT "personal_artifacts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_artifacts" ADD CONSTRAINT "personal_artifacts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_artifacts" ADD CONSTRAINT "personal_artifacts_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_drafts" ADD CONSTRAINT "personal_drafts_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_drafts" ADD CONSTRAINT "personal_drafts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_drafts" ADD CONSTRAINT "personal_drafts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_drafts" ADD CONSTRAINT "personal_drafts_target_channel_id_channels_id_fk" FOREIGN KEY ("target_channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_drafts" ADD CONSTRAINT "personal_drafts_receipt_message_id_messages_id_fk" FOREIGN KEY ("receipt_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_groups" ADD CONSTRAINT "personal_groups_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_groups" ADD CONSTRAINT "personal_groups_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_groups" ADD CONSTRAINT "personal_groups_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_preferences" ADD CONSTRAINT "personal_preferences_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_preferences" ADD CONSTRAINT "personal_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_resource_revisions" ADD CONSTRAINT "personal_resource_revisions_resource_id_personal_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."personal_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_resources" ADD CONSTRAINT "personal_resources_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_resources" ADD CONSTRAINT "personal_resources_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_resources" ADD CONSTRAINT "personal_resources_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_resources" ADD CONSTRAINT "personal_resources_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_routine_runs" ADD CONSTRAINT "personal_routine_runs_routine_id_personal_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."personal_routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_routine_runs" ADD CONSTRAINT "personal_routine_runs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_routines" ADD CONSTRAINT "personal_routines_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_routines" ADD CONSTRAINT "personal_routines_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_routines" ADD CONSTRAINT "personal_routines_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_routines" ADD CONSTRAINT "personal_routines_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_routines" ADD CONSTRAINT "personal_routines_skill_id_personal_resources_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."personal_resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personal_artifacts_owner" ON "personal_artifacts" USING btree ("server_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "personal_drafts_owner" ON "personal_drafts" USING btree ("server_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "personal_groups_owner" ON "personal_groups" USING btree ("server_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "personal_resources_owner" ON "personal_resources" USING btree ("server_id","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_routine_occurrence" ON "personal_routine_runs" USING btree ("routine_id","schedule_version","scheduled_for","trigger");--> statement-breakpoint
CREATE INDEX "personal_routine_run_status" ON "personal_routine_runs" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX "personal_routines_due" ON "personal_routines" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "personal_routines_owner" ON "personal_routines" USING btree ("server_id","owner_user_id");