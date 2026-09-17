CREATE TABLE "event_chronology_edges" (
	"campaign_id" uuid NOT NULL,
	"before_document_id" text NOT NULL,
	"after_document_id" text NOT NULL,
	CONSTRAINT "event_chronology_edges_campaign_before_after_pk" PRIMARY KEY("campaign_id","before_document_id","after_document_id"),
	CONSTRAINT "event_chronology_edges_different_documents_check" CHECK ("event_chronology_edges"."before_document_id" <> "event_chronology_edges"."after_document_id")
);
--> statement-breakpoint
ALTER TABLE "event_chronology_edges" ADD CONSTRAINT "event_chronology_edges_campaign_before_document_fk" FOREIGN KEY ("campaign_id","before_document_id") REFERENCES "public"."vault_documents"("campaign_id","document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_chronology_edges" ADD CONSTRAINT "event_chronology_edges_campaign_after_document_fk" FOREIGN KEY ("campaign_id","after_document_id") REFERENCES "public"."vault_documents"("campaign_id","document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_chronology_edges_campaign_before_index" ON "event_chronology_edges" USING btree ("campaign_id","before_document_id");--> statement-breakpoint
CREATE INDEX "event_chronology_edges_campaign_after_index" ON "event_chronology_edges" USING btree ("campaign_id","after_document_id");