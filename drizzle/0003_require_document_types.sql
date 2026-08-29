UPDATE "context_fragments" SET "document_type" = 'lore' WHERE "document_type" IS NULL;
--> statement-breakpoint
UPDATE "vault_documents" SET "type" = 'lore' WHERE "type" IS NULL;
--> statement-breakpoint
ALTER TABLE "context_fragments" ALTER COLUMN "document_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "vault_documents" ALTER COLUMN "type" SET NOT NULL;
