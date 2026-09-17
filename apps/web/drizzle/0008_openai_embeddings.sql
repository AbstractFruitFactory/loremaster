TRUNCATE TABLE "context_embedding_cache";--> statement-breakpoint
TRUNCATE TABLE "vault_fragment_embeddings";--> statement-breakpoint
ALTER TABLE "context_embedding_cache" ALTER COLUMN "embedding" SET DATA TYPE vector(1536);--> statement-breakpoint
ALTER TABLE "vault_fragment_embeddings" ALTER COLUMN "embedding" SET DATA TYPE vector(1536);
