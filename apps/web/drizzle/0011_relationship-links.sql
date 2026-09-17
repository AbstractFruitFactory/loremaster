CREATE TABLE "vault_relationship_links" (
	"campaign_id" uuid NOT NULL,
	"source_document_id" text NOT NULL,
	"target_document_id" text NOT NULL,
	"relationship" varchar(48) NOT NULL,
	CONSTRAINT "vault_relationship_links_campaign_source_target_relationship_pk" PRIMARY KEY("campaign_id","source_document_id","target_document_id","relationship"),
	CONSTRAINT "vault_relationship_links_different_documents_check" CHECK ("vault_relationship_links"."source_document_id" <> "vault_relationship_links"."target_document_id")
);
--> statement-breakpoint
ALTER TABLE "vault_relationship_links" ADD CONSTRAINT "vault_relationship_links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_relationship_links" ADD CONSTRAINT "vault_relationship_links_campaign_source_document_fk" FOREIGN KEY ("campaign_id","source_document_id") REFERENCES "public"."vault_documents"("campaign_id","document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_relationship_links" ADD CONSTRAINT "vault_relationship_links_campaign_target_document_fk" FOREIGN KEY ("campaign_id","target_document_id") REFERENCES "public"."vault_documents"("campaign_id","document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vault_relationship_links_campaign_source_index" ON "vault_relationship_links" USING btree ("campaign_id","source_document_id");--> statement-breakpoint
CREATE INDEX "vault_relationship_links_campaign_target_index" ON "vault_relationship_links" USING btree ("campaign_id","target_document_id");