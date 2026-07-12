CREATE TABLE "library_changes" (
  "revision" BIGSERIAL NOT NULL,
  "library_id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "library_changes_pkey" PRIMARY KEY ("revision")
);

CREATE INDEX "library_changes_library_id_revision_idx" ON "library_changes"("library_id", "revision");

CREATE FUNCTION record_item_library_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
    VALUES (OLD.library_id, 'item', OLD.id, 'delete');
    RETURN OLD;
  END IF;
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  VALUES (NEW.library_id, 'item', NEW.id, CASE WHEN NEW.deleted_at IS NOT NULL THEN 'delete' ELSE 'upsert' END);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER library_changes_items AFTER INSERT OR UPDATE OR DELETE ON items
FOR EACH ROW EXECUTE FUNCTION record_item_library_change();

CREATE FUNCTION record_annotation_library_change() RETURNS trigger AS $$
DECLARE target_item_id TEXT;
BEGIN
  target_item_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.item_id ELSE NEW.item_id END;
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  SELECT library_id, 'item', target_item_id, 'upsert' FROM items WHERE id = target_item_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER library_changes_annotations AFTER INSERT OR UPDATE OR DELETE ON annotations
FOR EACH ROW EXECUTE FUNCTION record_annotation_library_change();

CREATE FUNCTION record_document_library_change() RETURNS trigger AS $$
DECLARE target_document_id TEXT;
BEGIN
  target_document_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  SELECT library_id, 'item', id, 'upsert' FROM items
  WHERE document_id = target_document_id AND deleted_at IS NULL;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER library_changes_documents AFTER UPDATE OR DELETE ON documents
FOR EACH ROW EXECUTE FUNCTION record_document_library_change();

CREATE FUNCTION record_source_library_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
    VALUES (OLD.library_id, 'source', OLD.id, 'delete');
    RETURN OLD;
  END IF;
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  VALUES (NEW.library_id, 'source', NEW.id, CASE WHEN NEW.status = 'unsubscribed' THEN 'delete' ELSE 'upsert' END);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER library_changes_sources AFTER INSERT OR UPDATE OR DELETE ON sources
FOR EACH ROW EXECUTE FUNCTION record_source_library_change();

CREATE FUNCTION record_account_settings_library_change() RETURNS trigger AS $$
DECLARE target_account_id TEXT;
BEGIN
  target_account_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.account_id ELSE NEW.account_id END;
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  SELECT id, 'settings', target_account_id, 'upsert'
  FROM libraries WHERE account_id = target_account_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER library_changes_reading_settings AFTER INSERT OR UPDATE OR DELETE ON account_reading_preferences
FOR EACH ROW EXECUTE FUNCTION record_account_settings_library_change();

CREATE TRIGGER library_changes_llm_settings AFTER INSERT OR UPDATE OR DELETE ON llm_settings
FOR EACH ROW EXECUTE FUNCTION record_account_settings_library_change();
