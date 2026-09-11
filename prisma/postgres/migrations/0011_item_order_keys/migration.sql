ALTER TABLE items ADD COLUMN activity_at TIMESTAMP(3) GENERATED ALWAYS AS
  (GREATEST(created_at, last_read_at)) STORED;
ALTER TABLE items ADD COLUMN feed_at TIMESTAMP(3) GENERATED ALWAYS AS
  (COALESCE(published_at, created_at)) STORED;
CREATE INDEX items_activity_order_idx ON items
  (library_id, saved_to_library, archived_at, deleted_at, activity_at DESC, created_at DESC, id ASC);
CREATE INDEX items_feed_order_idx ON items
  (library_id, saved_to_library, archived_at, deleted_at, feed_at DESC, created_at DESC, id ASC);
