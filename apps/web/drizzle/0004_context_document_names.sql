CREATE TABLE "context_document_names" (
	"campaign_id" uuid NOT NULL,
	"document_id" text NOT NULL,
	"normalized_name" text NOT NULL,
	CONSTRAINT "context_document_names_campaign_document_name_pk" PRIMARY KEY("campaign_id","document_id","normalized_name")
);
--> statement-breakpoint
ALTER TABLE "context_document_names" ADD CONSTRAINT "context_document_names_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_document_names" ADD CONSTRAINT "context_document_names_campaign_document_fk" FOREIGN KEY ("campaign_id","document_id") REFERENCES "public"."vault_documents"("campaign_id","document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "context_document_names_campaign_name_index" ON "context_document_names" USING btree ("campaign_id","normalized_name");
