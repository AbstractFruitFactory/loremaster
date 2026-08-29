CREATE TABLE "context_embedding_cache" (
	"model" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_embedding_cache_model_content_hash_pk" PRIMARY KEY("model","content_hash")
);
--> statement-breakpoint
CREATE TABLE "context_fragments" (
	"id" text NOT NULL,
	"campaign_id" uuid NOT NULL,
	"document_id" text NOT NULL,
	"title" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"aliases_text" text DEFAULT '' NOT NULL,
	"document_type" text,
	"heading" text,
	"content" text NOT NULL,
	"position" integer NOT NULL,
	"content_hash" text NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (
					setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
					setweight(to_tsvector('simple', coalesce(aliases_text, '')), 'B') ||
					setweight(to_tsvector('simple', coalesce(heading, '')), 'C') ||
					setweight(to_tsvector('simple', coalesce(content, '')), 'D')
				) STORED NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_fragments_campaign_id_fragment_id_pk" PRIMARY KEY("campaign_id","id")
);
--> statement-breakpoint
ALTER TABLE "context_fragments" ADD CONSTRAINT "context_fragments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_fragments" ADD CONSTRAINT "context_fragments_campaign_document_fk" FOREIGN KEY ("campaign_id","document_id") REFERENCES "public"."vault_documents"("campaign_id","document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "context_fragments_campaign_document_position_unique" ON "context_fragments" USING btree ("campaign_id","document_id","position");--> statement-breakpoint
CREATE INDEX "context_fragments_campaign_document_index" ON "context_fragments" USING btree ("campaign_id","document_id");--> statement-breakpoint
CREATE INDEX "context_fragments_search_vector_index" ON "context_fragments" USING gin ("search_vector");
