ALTER TABLE "guild_settings" ADD COLUMN "calendar_message_id" varchar(32);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "guild_settings" TO lw_app;
