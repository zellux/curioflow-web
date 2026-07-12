CREATE TABLE library_changes (
  revision INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  library_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- statement-breakpoint
CREATE INDEX library_changes_library_id_revision_idx ON library_changes (library_id, revision);

-- statement-breakpoint
CREATE TRIGGER library_changes_item_insert AFTER INSERT ON items BEGIN
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  VALUES (NEW.library_id, 'item', NEW.id, 'upsert');
END;

-- statement-breakpoint
CREATE TRIGGER library_changes_item_update AFTER UPDATE ON items BEGIN
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  VALUES (NEW.library_id, 'item', NEW.id, CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END);
END;

-- statement-breakpoint
CREATE TRIGGER library_changes_item_delete AFTER DELETE ON items BEGIN
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  VALUES (OLD.library_id, 'item', OLD.id, 'delete');
END;

-- statement-breakpoint
CREATE TRIGGER library_changes_annotation_insert AFTER INSERT ON annotations BEGIN
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  SELECT library_id, 'item', NEW.item_id, 'upsert' FROM items WHERE id = NEW.item_id;
END;

-- statement-breakpoint
CREATE TRIGGER library_changes_annotation_update AFTER UPDATE ON annotations BEGIN
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  SELECT library_id, 'item', NEW.item_id, 'upsert' FROM items WHERE id = NEW.item_id;
END;

-- statement-breakpoint
CREATE TRIGGER library_changes_annotation_delete AFTER DELETE ON annotations BEGIN
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  SELECT library_id, 'item', OLD.item_id, 'upsert' FROM items WHERE id = OLD.item_id;
END;

-- statement-breakpoint
CREATE TRIGGER library_changes_document_update AFTER UPDATE ON documents BEGIN
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  SELECT library_id, 'item', id, 'upsert' FROM items WHERE document_id = NEW.id AND deleted_at IS NULL;
END;

-- statement-breakpoint
CREATE TRIGGER library_changes_source_insert AFTER INSERT ON sources BEGIN
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  VALUES (NEW.library_id, 'source', NEW.id, 'upsert');
END;

-- statement-breakpoint
CREATE TRIGGER library_changes_source_update AFTER UPDATE ON sources BEGIN
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  VALUES (NEW.library_id, 'source', NEW.id, CASE WHEN NEW.status = 'unsubscribed' THEN 'delete' ELSE 'upsert' END);
END;

-- statement-breakpoint
CREATE TRIGGER library_changes_source_delete AFTER DELETE ON sources BEGIN
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  VALUES (OLD.library_id, 'source', OLD.id, 'delete');
END;

-- statement-breakpoint
CREATE TRIGGER library_changes_reading_settings_insert AFTER INSERT ON account_reading_preferences BEGIN
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  SELECT id, 'settings', NEW.account_id, 'upsert' FROM libraries WHERE account_id = NEW.account_id;
END;

-- statement-breakpoint
CREATE TRIGGER library_changes_reading_settings_update AFTER UPDATE ON account_reading_preferences BEGIN
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  SELECT id, 'settings', NEW.account_id, 'upsert' FROM libraries WHERE account_id = NEW.account_id;
END;

-- statement-breakpoint
CREATE TRIGGER library_changes_llm_settings_insert AFTER INSERT ON llm_settings BEGIN
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  SELECT id, 'settings', NEW.account_id, 'upsert' FROM libraries WHERE account_id = NEW.account_id;
END;

-- statement-breakpoint
CREATE TRIGGER library_changes_llm_settings_update AFTER UPDATE ON llm_settings BEGIN
  INSERT INTO library_changes (library_id, entity_type, entity_id, operation)
  SELECT id, 'settings', NEW.account_id, 'upsert' FROM libraries WHERE account_id = NEW.account_id;
END;
