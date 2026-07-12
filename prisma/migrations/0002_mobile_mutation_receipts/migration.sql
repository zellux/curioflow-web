CREATE TABLE mobile_mutation_receipts (
  id TEXT NOT NULL PRIMARY KEY,
  library_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  client_mutation_id TEXT NOT NULL,
  item_id TEXT,
  response_json TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT mobile_mutation_receipts_library_id_fkey
    FOREIGN KEY (library_id) REFERENCES libraries (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX mobile_mutation_receipts_library_device_mutation_key
  ON mobile_mutation_receipts (library_id, device_id, client_mutation_id);

CREATE INDEX mobile_mutation_receipts_created_at_idx
  ON mobile_mutation_receipts (created_at);
