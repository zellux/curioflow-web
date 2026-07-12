-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quota_version" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "llm_settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "base_url" TEXT,
    "model" TEXT NOT NULL,
    "ask_model" TEXT,
    "api_key" TEXT,
    "system_language" TEXT NOT NULL DEFAULT 'en',
    "summary_language" TEXT NOT NULL DEFAULT 'en',
    "summary_concurrency" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "llm_settings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "account_reading_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'broadsheet',
    "font" TEXT NOT NULL DEFAULT 'serif',
    "color_mode" TEXT NOT NULL DEFAULT 'bright',
    "font_scale" REAL NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "account_reading_preferences_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "auth_throttle_buckets" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL,
    "window_started_at" DATETIME NOT NULL,
    "locked_until" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "libraries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "libraries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "library_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_checked_at" DATETIME,
    "next_fetch_at" DATETIME,
    "refresh_interval_minutes" INTEGER NOT NULL DEFAULT 60,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "http_etag" TEXT,
    "http_last_modified" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sources_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "libraries" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "library_id" TEXT NOT NULL,
    "source_id" TEXT,
    "content_object_id" TEXT,
    "document_id" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "author" TEXT,
    "published_at" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "read_status" TEXT NOT NULL DEFAULT 'unread',
    "saved_to_library" BOOLEAN NOT NULL DEFAULT true,
    "reading_progress" REAL NOT NULL DEFAULT 0,
    "reading_position_json" TEXT NOT NULL DEFAULT '{}',
    "last_read_at" DATETIME,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME,
    CONSTRAINT "items_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "libraries" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "items_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "items_content_object_id_fkey" FOREIGN KEY ("content_object_id") REFERENCES "content_objects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "source_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "library_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "entry_key" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "author" TEXT,
    "published_at" DATETIME,
    "first_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "source_entries_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "libraries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "source_entries_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "source_entries_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "content_objects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonical_key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "cache_scope" TEXT NOT NULL DEFAULT 'public_web',
    "owner_account_id" TEXT,
    "normalized_url" TEXT,
    "url_hash" TEXT,
    "file_sha256" TEXT,
    "source_fingerprint" TEXT,
    "latest_document_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "first_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "content_objects_owner_account_id_fkey" FOREIGN KEY ("owner_account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cached_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "file_sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "original_filename" TEXT,
    "owner_account_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cached_files_owner_account_id_fkey" FOREIGN KEY ("owner_account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content_object_id" TEXT NOT NULL,
    "cached_file_id" TEXT,
    "owner_account_id" TEXT,
    "content_type" TEXT NOT NULL,
    "title" TEXT,
    "article_html" TEXT,
    "text" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "language" TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documents_content_object_id_fkey" FOREIGN KEY ("content_object_id") REFERENCES "content_objects" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "documents_cached_file_id_fkey" FOREIGN KEY ("cached_file_id") REFERENCES "cached_files" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "documents_owner_account_id_fkey" FOREIGN KEY ("owner_account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "embedding_model" TEXT,
    "embedding_json" TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "annotations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "note" TEXT,
    "location_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "annotations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "annotations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "annotations_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "briefs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "library_id" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sections_json" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ready',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "briefs_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "libraries" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chat_threads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "library_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "item_id" TEXT,
    "title" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_threads_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "libraries" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "chat_threads_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations_json" TEXT NOT NULL DEFAULT '[]',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "library_id" TEXT,
    "content_object_id" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "payload_json" TEXT NOT NULL DEFAULT '{}',
    "progress_json" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "next_run_at" DATETIME,
    "locked_until" DATETIME,
    "lease_owner" TEXT,
    "lease_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" DATETIME,
    "finished_at" DATETIME,
    CONSTRAINT "jobs_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "libraries" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "jobs_content_object_id_fkey" FOREIGN KEY ("content_object_id") REFERENCES "content_objects" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "account_exports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "json_storage_key" TEXT,
    "markdown_storage_key" TEXT,
    "opml_storage_key" TEXT,
    "download_token_hash" TEXT,
    "download_expires_at" DATETIME,
    "retained_until" DATETIME,
    "downloaded_at" DATETIME,
    "error" TEXT,
    "requested_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME,
    CONSTRAINT "account_exports_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "usage_reservations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "usage_reservations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "llm_settings_account_id_key" ON "llm_settings"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_reading_preferences_account_id_key" ON "account_reading_preferences"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_account_id_key" ON "users"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "auth_throttle_buckets_updated_at_idx" ON "auth_throttle_buckets"("updated_at");

-- CreateIndex
CREATE INDEX "sources_status_next_fetch_at_idx" ON "sources"("status", "next_fetch_at");

-- CreateIndex
CREATE INDEX "items_library_id_created_at_idx" ON "items"("library_id", "created_at");

-- CreateIndex
CREATE INDEX "items_library_id_archived_at_idx" ON "items"("library_id", "archived_at");

-- CreateIndex
CREATE INDEX "items_library_id_updated_at_idx" ON "items"("library_id", "updated_at");

-- CreateIndex
CREATE INDEX "items_library_id_deleted_at_idx" ON "items"("library_id", "deleted_at");

-- CreateIndex
CREATE INDEX "items_content_object_id_idx" ON "items"("content_object_id");

-- CreateIndex
CREATE UNIQUE INDEX "items_library_id_content_object_id_key" ON "items"("library_id", "content_object_id");

-- CreateIndex
CREATE INDEX "source_entries_library_id_item_id_idx" ON "source_entries"("library_id", "item_id");

-- CreateIndex
CREATE INDEX "source_entries_source_id_published_at_idx" ON "source_entries"("source_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "source_entries_source_id_item_id_key" ON "source_entries"("source_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_entries_source_id_entry_key_key" ON "source_entries"("source_id", "entry_key");

-- CreateIndex
CREATE UNIQUE INDEX "content_objects_canonical_key_key" ON "content_objects"("canonical_key");

-- CreateIndex
CREATE UNIQUE INDEX "content_objects_url_hash_key" ON "content_objects"("url_hash");

-- CreateIndex
CREATE UNIQUE INDEX "content_objects_file_sha256_key" ON "content_objects"("file_sha256");

-- CreateIndex
CREATE INDEX "content_objects_owner_account_id_idx" ON "content_objects"("owner_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "cached_files_file_sha256_key" ON "cached_files"("file_sha256");

-- CreateIndex
CREATE INDEX "cached_files_owner_account_id_idx" ON "cached_files"("owner_account_id");

-- CreateIndex
CREATE INDEX "documents_content_object_id_idx" ON "documents"("content_object_id");

-- CreateIndex
CREATE INDEX "documents_owner_account_id_idx" ON "documents"("owner_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_id_chunk_index_key" ON "document_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE INDEX "briefs_library_id_date_idx" ON "briefs"("library_id", "date");

-- CreateIndex
CREATE INDEX "jobs_status_type_idx" ON "jobs"("status", "type");

-- CreateIndex
CREATE INDEX "jobs_status_next_run_at_idx" ON "jobs"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "jobs_locked_until_idx" ON "jobs"("locked_until");

-- CreateIndex
CREATE UNIQUE INDEX "account_exports_download_token_hash_key" ON "account_exports"("download_token_hash");

-- CreateIndex
CREATE INDEX "account_exports_account_id_requested_at_idx" ON "account_exports"("account_id", "requested_at");

-- CreateIndex
CREATE INDEX "account_exports_status_retained_until_idx" ON "account_exports"("status", "retained_until");

-- CreateIndex
CREATE UNIQUE INDEX "usage_reservations_idempotency_key_key" ON "usage_reservations"("idempotency_key");

-- CreateIndex
CREATE INDEX "usage_reservations_account_id_event_type_status_idx" ON "usage_reservations"("account_id", "event_type", "status");

-- CreateIndex
CREATE INDEX "usage_reservations_expires_at_status_idx" ON "usage_reservations"("expires_at", "status");
