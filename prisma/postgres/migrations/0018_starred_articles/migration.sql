ALTER TABLE "items" ADD COLUMN "starred" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "items_starred_order_idx" ON "items" ("library_id", "starred", "deleted_at", "feed_at" DESC);
