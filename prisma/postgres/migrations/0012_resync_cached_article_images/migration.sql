-- Refresh existing native-reader HTML with absolute, authorized cache URLs.
INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
SELECT library_id, 'item', id, 'upsert'
FROM items
WHERE deleted_at IS NULL
  AND document_id IN (
    SELECT id FROM documents WHERE article_html LIKE '%/api/article-images/%'
  );
