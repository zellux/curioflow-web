-- Repair clients whose initial snapshot was truncated by older servers.
INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
SELECT library_id, 'item', id, 'upsert' FROM items WHERE deleted_at IS NULL;
