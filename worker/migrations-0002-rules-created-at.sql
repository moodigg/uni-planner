-- applied once to the live D1 (tables created before created_at existed)
ALTER TABLE rules ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
