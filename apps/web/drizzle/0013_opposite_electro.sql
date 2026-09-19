CREATE TABLE "campaign_import_accepted_claims" (
	"campaign_id" uuid NOT NULL,
	"claim_fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"event_title" text,
	"content" text NOT NULL,
	"entity_references" jsonb NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_import_accepted_claims_pk" PRIMARY KEY("campaign_id","claim_fingerprint")
);
--> statement-breakpoint
CREATE TABLE "campaign_import_claim_provenance" (
	"campaign_id" uuid NOT NULL,
	"claim_fingerprint" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_revision_id" uuid NOT NULL,
	"document_id" text NOT NULL,
	"vault_revision_id" text NOT NULL,
	"excerpt" text NOT NULL,
	"start_string_index" integer NOT NULL,
	"end_string_index" integer NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	CONSTRAINT "campaign_import_claim_provenance_pk" PRIMARY KEY("campaign_id","claim_fingerprint","source_id","source_revision_id","document_id","vault_revision_id","start_string_index","end_string_index")
);
--> statement-breakpoint
CREATE TABLE "campaign_import_chronology_provenance" (
	"campaign_id" uuid NOT NULL,
	"ingestion_id" text NOT NULL,
	"chronology_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"source_event_id" text NOT NULL,
	"target_event_id" text NOT NULL,
	"affected_document_id" text NOT NULL,
	"vault_revision_id" text NOT NULL,
	"claim_id" uuid NOT NULL,
	"claim_fingerprint" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_revision_id" uuid NOT NULL,
	"excerpt" text NOT NULL,
	"start_string_index" integer NOT NULL,
	"end_string_index" integer NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	CONSTRAINT "campaign_import_chronology_provenance_pk" PRIMARY KEY("campaign_id","ingestion_id","chronology_id","affected_document_id","vault_revision_id","claim_id","source_id","source_revision_id","start_string_index","end_string_index")
);
--> statement-breakpoint
CREATE TABLE "campaign_import_source_revisions" (
	"campaign_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_revision_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"title" text NOT NULL,
	"media_type" text NOT NULL,
	"content_hash" text NOT NULL,
	"byte_length" integer NOT NULL,
	"ingestion_id" text NOT NULL,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_import_source_revisions_pk" PRIMARY KEY("campaign_id","source_id","source_revision_id")
);
--> statement-breakpoint
ALTER TABLE "campaign_import_accepted_claims" ADD CONSTRAINT "campaign_import_accepted_claims_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_import_claim_provenance" ADD CONSTRAINT "campaign_import_claim_provenance_claim_fk" FOREIGN KEY ("campaign_id","claim_fingerprint") REFERENCES "public"."campaign_import_accepted_claims"("campaign_id","claim_fingerprint") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_import_claim_provenance" ADD CONSTRAINT "campaign_import_claim_provenance_source_fk" FOREIGN KEY ("campaign_id","source_id","source_revision_id") REFERENCES "public"."campaign_import_source_revisions"("campaign_id","source_id","source_revision_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_import_claim_provenance" ADD CONSTRAINT "campaign_import_claim_provenance_document_fk" FOREIGN KEY ("campaign_id","document_id") REFERENCES "public"."vault_documents"("campaign_id","document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_import_claim_provenance" ADD CONSTRAINT "campaign_import_claim_provenance_revision_fk" FOREIGN KEY ("campaign_id","vault_revision_id") REFERENCES "public"."vault_revisions"("campaign_id","revision_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_import_chronology_provenance" ADD CONSTRAINT "campaign_import_chronology_provenance_claim_fk" FOREIGN KEY ("campaign_id","claim_fingerprint") REFERENCES "public"."campaign_import_accepted_claims"("campaign_id","claim_fingerprint") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_import_chronology_provenance" ADD CONSTRAINT "campaign_import_chronology_provenance_source_fk" FOREIGN KEY ("campaign_id","source_id","source_revision_id") REFERENCES "public"."campaign_import_source_revisions"("campaign_id","source_id","source_revision_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_import_chronology_provenance" ADD CONSTRAINT "campaign_import_chronology_provenance_document_fk" FOREIGN KEY ("campaign_id","affected_document_id") REFERENCES "public"."vault_documents"("campaign_id","document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_import_chronology_provenance" ADD CONSTRAINT "campaign_import_chronology_provenance_revision_fk" FOREIGN KEY ("campaign_id","vault_revision_id") REFERENCES "public"."vault_revisions"("campaign_id","revision_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_import_source_revisions" ADD CONSTRAINT "campaign_import_source_revisions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_import_claim_provenance_source_index" ON "campaign_import_claim_provenance" USING btree ("campaign_id","source_id","source_revision_id");--> statement-breakpoint
CREATE INDEX "campaign_import_claim_provenance_document_index" ON "campaign_import_claim_provenance" USING btree ("campaign_id","document_id");--> statement-breakpoint
CREATE INDEX "campaign_import_chronology_provenance_ingestion_index" ON "campaign_import_chronology_provenance" USING btree ("campaign_id","ingestion_id");--> statement-breakpoint
CREATE INDEX "campaign_import_chronology_provenance_source_index" ON "campaign_import_chronology_provenance" USING btree ("campaign_id","source_id","source_revision_id");--> statement-breakpoint
CREATE INDEX "campaign_import_chronology_provenance_document_index" ON "campaign_import_chronology_provenance" USING btree ("campaign_id","affected_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_import_source_revisions_hash_unique" ON "campaign_import_source_revisions" USING btree ("campaign_id","source_id","content_hash");--> statement-breakpoint
CREATE INDEX "campaign_import_source_revisions_source_index" ON "campaign_import_source_revisions" USING btree ("campaign_id","source_id");