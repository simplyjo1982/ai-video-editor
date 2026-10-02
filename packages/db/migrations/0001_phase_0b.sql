CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END;
$$;

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_owner_idx ON projects(owner_id, created_at);

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  original_filename text NOT NULL CHECK (length(trim(original_filename)) > 0),
  storage_backend text NOT NULL DEFAULT 'local',
  storage_namespace text NOT NULL DEFAULT 'originals',
  storage_path text NOT NULL CHECK (storage_path <> '' AND storage_path !~ '(^/|:|\\|(^|/)\.\.(/|$))'),
  media_type text NOT NULL CHECK (length(trim(media_type)) > 0),
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes >= 0),
  duration_ms bigint CHECK (duration_ms >= 0),
  width integer CHECK (width > 0),
  height integer CHECK (height > 0),
  codec text,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN
    ('uploading','uploaded','validating','analyzing','ready','partial','failed','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, id)
);
CREATE INDEX media_assets_project_idx ON media_assets(project_id, created_at);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  media_asset_id uuid,
  job_type text NOT NULL CHECK (length(trim(job_type)) > 0),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN
    ('queued','running','retry_wait','pause_requested','paused','succeeded','failed','cancel_requested','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  lease_token uuid,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  pause_reason text CHECK (pause_reason IN ('user','budget','capacity','dependency')),
  idempotency_key text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (attempt_count >= 0 AND attempt_count <= max_attempts),
  CHECK (num_nonnulls(locked_at, locked_by, lease_token, lease_expires_at) IN (0,4)),
  CHECK (lease_expires_at > locked_at),
  FOREIGN KEY(project_id, media_asset_id) REFERENCES media_assets(project_id, id)
);
CREATE INDEX jobs_project_idx ON jobs(project_id, created_at);
CREATE INDEX jobs_media_idx ON jobs(project_id, media_asset_id);
CREATE INDEX jobs_claim_idx ON jobs(available_at, created_at, id) WHERE status IN ('queued','retry_wait');
CREATE INDEX jobs_lease_idx ON jobs(lease_expires_at) WHERE lease_expires_at IS NOT NULL;
CREATE UNIQUE INDEX jobs_idempotency_idx ON jobs(project_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  media_asset_id uuid NOT NULL,
  analysis_type text NOT NULL CHECK (length(trim(analysis_type)) > 0),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  revision integer NOT NULL CHECK (revision > 0),
  pipeline_version text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  model_provider text,
  model_identifier text,
  prompt_version text,
  input_hash text,
  cache_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(project_id, media_asset_id) REFERENCES media_assets(project_id, id),
  UNIQUE(project_id, media_asset_id, analysis_type, revision)
);
CREATE INDEX analysis_runs_project_idx ON analysis_runs(project_id, created_at);
CREATE INDEX analysis_runs_cache_idx ON analysis_runs(project_id, cache_key) WHERE cache_key IS NOT NULL;

CREATE TRIGGER projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER media_assets_updated BEFORE UPDATE ON media_assets FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER jobs_updated BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER analysis_runs_updated BEFORE UPDATE ON analysis_runs FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
