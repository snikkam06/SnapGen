-- Prisma applies migrations inside a transaction, so these indexes cannot use CONCURRENTLY.
-- CreateIndex
CREATE INDEX IF NOT EXISTS "credit_ledgers_user_id_created_at_idx" ON "credit_ledgers"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "characters_user_id_status_created_at_idx" ON "characters"("user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "character_datasets_character_id_created_at_idx" ON "character_datasets"("character_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "assets_user_id_created_at_idx" ON "assets"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "assets_user_id_kind_created_at_idx" ON "assets"("user_id", "kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "assets_user_id_moderation_status_created_at_idx" ON "assets"("user_id", "moderation_status", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "generation_jobs_user_id_created_at_idx" ON "generation_jobs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "generation_jobs_user_id_status_created_at_idx" ON "generation_jobs"("user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "generation_jobs_status_created_at_idx" ON "generation_jobs"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_assets_job_id_relation_created_at_idx" ON "job_assets"("job_id", "relation", "created_at" DESC);
