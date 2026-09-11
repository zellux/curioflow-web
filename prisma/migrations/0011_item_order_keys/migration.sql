ALTER TABLE items ADD COLUMN activity_at DATETIME GENERATED ALWAYS AS
  (CASE WHEN last_read_at > created_at THEN last_read_at ELSE created_at END) VIRTUAL;
ALTER TABLE items ADD COLUMN feed_at DATETIME GENERATED ALWAYS AS
  (COALESCE(published_at, created_at)) VIRTUAL;
CREATE INDEX items_activity_order_idx ON items
  (library_id, saved_to_library, archived_at, deleted_at, activity_at DESC, created_at DESC, id ASC);
CREATE INDEX items_feed_order_idx ON items
  (library_id, saved_to_library, archived_at, deleted_at, feed_at DESC, created_at DESC, id ASC);
