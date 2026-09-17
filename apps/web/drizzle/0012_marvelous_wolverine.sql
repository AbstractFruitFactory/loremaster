CREATE TABLE "event_during_edges" (
	"campaign_id" uuid NOT NULL,
	"event_document_id" text NOT NULL,
	"period_document_id" text NOT NULL,
	CONSTRAINT "event_during_edges_campaign_event_period_pk" PRIMARY KEY("campaign_id","event_document_id","period_document_id"),
	CONSTRAINT "event_during_edges_different_documents_check" CHECK ("event_during_edges"."event_document_id" <> "event_during_edges"."period_document_id")
);
--> statement-breakpoint
ALTER TABLE "event_during_edges" ADD CONSTRAINT "event_during_edges_campaign_event_document_fk" FOREIGN KEY ("campaign_id","event_document_id") REFERENCES "public"."vault_documents"("campaign_id","document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_during_edges" ADD CONSTRAINT "event_during_edges_campaign_period_document_fk" FOREIGN KEY ("campaign_id","period_document_id") REFERENCES "public"."vault_documents"("campaign_id","document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_during_edges_campaign_event_index" ON "event_during_edges" USING btree ("campaign_id","event_document_id");--> statement-breakpoint
CREATE INDEX "event_during_edges_campaign_period_index" ON "event_during_edges" USING btree ("campaign_id","period_document_id");