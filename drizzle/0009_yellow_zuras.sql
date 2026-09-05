CREATE TABLE "vault_revision_heads" (
	"campaign_id" uuid NOT NULL,
	"document_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"path" text NOT NULL,
	"source_hash" text,
	CONSTRAINT "vault_revision_heads_campaign_document_pk" PRIMARY KEY("campaign_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "vault_revisions" (
	"campaign_id" uuid NOT NULL,
	"revision_id" text NOT NULL,
	"previous_revision_id" text,
	"transaction_id" text NOT NULL,
	"document_id" text NOT NULL,
	"path" text NOT NULL,
	"operation" text NOT NULL,
	"source" text NOT NULL,
	"related_session_id" text,
	"ingestion_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"before_hash" text,
	"after_hash" text,
	"change_summary" text,
	CONSTRAINT "vault_revisions_campaign_revision_pk" PRIMARY KEY("campaign_id","revision_id")
);
--> statement-breakpoint
ALTER TABLE "vault_revision_heads" ADD CONSTRAINT "vault_revision_heads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_revision_heads" ADD CONSTRAINT "vault_revision_heads_campaign_revision_fk" FOREIGN KEY ("campaign_id","revision_id") REFERENCES "public"."vault_revisions"("campaign_id","revision_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_revisions" ADD CONSTRAINT "vault_revisions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vault_revision_heads_campaign_index" ON "vault_revision_heads" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_revisions_campaign_transaction_unique" ON "vault_revisions" USING btree ("campaign_id","transaction_id");--> statement-breakpoint
CREATE INDEX "vault_revisions_campaign_document_created_index" ON "vault_revisions" USING btree ("campaign_id","document_id","created_at");