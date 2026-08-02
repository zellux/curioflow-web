CREATE TABLE "newsletter_addresses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "suspended_at" DATETIME,
    "revoked_at" DATETIME,
    CONSTRAINT "newsletter_addresses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "newsletter_addresses_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "libraries" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "newsletter_identities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "library_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "authenticated_domain" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "user_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "blocked_at" DATETIME,
    "first_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "newsletter_identities_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "libraries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "newsletter_identities_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "inbound_emails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "library_id" TEXT NOT NULL,
    "address_id" TEXT NOT NULL,
    "source_id" TEXT,
    "item_id" TEXT,
    "provider_message_id" TEXT NOT NULL,
    "message_id" TEXT,
    "envelope_from" TEXT,
    "from_address" TEXT,
    "from_name" TEXT,
    "list_id" TEXT,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "spf_verdict" TEXT NOT NULL DEFAULT 'unknown',
    "dkim_verdict" TEXT NOT NULL DEFAULT 'unknown',
    "dmarc_verdict" TEXT NOT NULL DEFAULT 'unknown',
    "spam_verdict" TEXT NOT NULL DEFAULT 'unknown',
    "virus_verdict" TEXT NOT NULL DEFAULT 'unknown',
    "raw_storage_key" TEXT,
    "failure_category" TEXT,
    "received_at" DATETIME NOT NULL,
    "processed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inbound_emails_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "libraries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inbound_emails_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "newsletter_addresses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inbound_emails_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "inbound_emails_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "newsletter_addresses_account_id_key" ON "newsletter_addresses"("account_id");
CREATE UNIQUE INDEX "newsletter_addresses_library_id_key" ON "newsletter_addresses"("library_id");
CREATE UNIQUE INDEX "newsletter_addresses_address_key" ON "newsletter_addresses"("address");
CREATE UNIQUE INDEX "newsletter_addresses_token_hash_key" ON "newsletter_addresses"("token_hash");
CREATE INDEX "newsletter_addresses_status_idx" ON "newsletter_addresses"("status");
CREATE UNIQUE INDEX "newsletter_identities_source_id_kind_value_key" ON "newsletter_identities"("source_id", "kind", "value");
CREATE INDEX "newsletter_identities_library_id_kind_value_idx" ON "newsletter_identities"("library_id", "kind", "value");
CREATE INDEX "newsletter_identities_source_id_blocked_at_idx" ON "newsletter_identities"("source_id", "blocked_at");
CREATE UNIQUE INDEX "inbound_emails_address_id_provider_message_id_key" ON "inbound_emails"("address_id", "provider_message_id");
CREATE INDEX "inbound_emails_library_id_message_id_idx" ON "inbound_emails"("library_id", "message_id");
CREATE INDEX "inbound_emails_library_id_status_received_at_idx" ON "inbound_emails"("library_id", "status", "received_at");
CREATE INDEX "inbound_emails_source_id_received_at_idx" ON "inbound_emails"("source_id", "received_at");
