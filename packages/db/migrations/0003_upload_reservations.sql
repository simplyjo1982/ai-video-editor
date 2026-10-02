CREATE TABLE upload_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  idempotency_key uuid NOT NULL,
  original_filename text NOT NULL,
  extension text NOT NULL CHECK (extension IN ('mp4','mov','m4v')),
  media_type text NOT NULL,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  received_bytes bigint NOT NULL DEFAULT 0 CHECK (received_bytes >= 0 AND received_bytes <= file_size_bytes),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','uploading','uploaded','rejected','expired')),
  policy_version text NOT NULL,
  policy_snapshot jsonb NOT NULL,
  content_sha256 text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, idempotency_key)
);
CREATE INDEX upload_reservations_active_idx ON upload_reservations(project_id, expires_at)
  WHERE state IN ('reserved','uploading');
CREATE TRIGGER upload_reservations_updated BEFORE UPDATE ON upload_reservations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
