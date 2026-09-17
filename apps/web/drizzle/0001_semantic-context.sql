CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "vault_fragment_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"vector_id" text NOT NULL,
	"embedding" vector(64) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"namespace" varchar(255) DEFAULT 'default' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vault_fragment_embeddings_namespace_vector_id_unique" ON "vault_fragment_embeddings" USING btree ("namespace","vector_id");