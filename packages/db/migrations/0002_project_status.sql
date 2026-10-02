ALTER TABLE projects ADD COLUMN status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'));
