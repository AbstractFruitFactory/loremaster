CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"document_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"document_id" text NOT NULL,
	"path" text NOT NULL,
	"title" text NOT NULL,
	"type" text,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"source_document_id" text NOT NULL,
	"target_name" text NOT NULL,
	"target_document_id" text
);
--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_documents" ADD CONSTRAINT "vault_documents_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_links" ADD CONSTRAINT "vault_links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vault_documents_campaign_document_id_unique" ON "vault_documents" USING btree ("campaign_id","document_id");--> statement-breakpoint
ALTER TABLE "vault_links" ADD CONSTRAINT "vault_links_campaign_target_document_fk" FOREIGN KEY ("campaign_id","target_document_id") REFERENCES "public"."vault_documents"("campaign_id","document_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "characters_campaign_document_id_unique" ON "characters" USING btree ("campaign_id","document_id");--> statement-breakpoint
CREATE INDEX "characters_campaign_id_index" ON "characters" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_documents_campaign_path_unique" ON "vault_documents" USING btree ("campaign_id","path");--> statement-breakpoint
CREATE INDEX "vault_documents_campaign_id_index" ON "vault_documents" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "vault_links_campaign_source_index" ON "vault_links" USING btree ("campaign_id","source_document_id");--> statement-breakpoint
CREATE INDEX "vault_links_campaign_target_index" ON "vault_links" USING btree ("campaign_id","target_document_id");