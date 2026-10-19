CREATE TABLE "article_translations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "item_id" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "plan_json" TEXT NOT NULL,
    "parts_json" TEXT NOT NULL DEFAULT '[]',
    "completed_chunks" INTEGER NOT NULL DEFAULT 0,
    "total_chunks" INTEGER NOT NULL,
    "title" TEXT,
    "article_html" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "article_translations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "article_translations_job_id_key" ON "article_translations"("job_id");
CREATE UNIQUE INDEX "article_translations_item_id_language_source_hash_key" ON "article_translations"("item_id", "language", "source_hash");
