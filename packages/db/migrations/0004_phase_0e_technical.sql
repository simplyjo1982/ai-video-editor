-- Phase 0E technical media intelligence. Existing migrations remain immutable.
ALTER TABLE media_assets
  ADD COLUMN original_sha256 text CHECK (original_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN admitted_duration_ms bigint CHECK (admitted_duration_ms > 0),
  ADD COLUMN current_technical_run_id uuid,
  ADD COLUMN technical_error text;
UPDATE media_assets m SET original_sha256=u.content_sha256
  FROM upload_reservations u WHERE u.id=m.id AND u.content_sha256 IS NOT NULL;

ALTER TABLE jobs
  ADD COLUMN config_snapshot jsonb,
  ADD COLUMN result_run_id uuid;
ALTER TABLE jobs ADD CONSTRAINT jobs_config_snapshot_object
  CHECK (config_snapshot IS NULL OR jsonb_typeof(config_snapshot)='object');

ALTER TABLE analysis_runs
  ADD COLUMN job_id uuid REFERENCES jobs(id),
  ADD COLUMN config_snapshot jsonb,
  ADD COLUMN toolchain jsonb,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN error_code text,
  ADD COLUMN coverage jsonb;
ALTER TABLE analysis_runs ADD CONSTRAINT analysis_runs_config_object
  CHECK (config_snapshot IS NULL OR jsonb_typeof(config_snapshot)='object');
ALTER TABLE analysis_runs ADD CONSTRAINT analysis_runs_identity_unique
  UNIQUE(project_id,media_asset_id,id);
ALTER TABLE media_assets ADD CONSTRAINT media_assets_current_technical_run_fk
  FOREIGN KEY(project_id,id,current_technical_run_id)
  REFERENCES analysis_runs(project_id,media_asset_id,id);
CREATE INDEX analysis_runs_technical_cache_idx ON analysis_runs(media_asset_id,cache_key)
  WHERE analysis_type='technical_media' AND status='succeeded';

CREATE TABLE artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  media_asset_id uuid NOT NULL,
  producing_run_id uuid,
  producing_job_id uuid REFERENCES jobs(id),
  artifact_class text NOT NULL CHECK (artifact_class IN ('original','working_video','timing_map','representative_frame')),
  storage_backend text NOT NULL DEFAULT 'local' CHECK (storage_backend='local'),
  storage_namespace text NOT NULL CHECK (storage_namespace IN ('originals','working')),
  storage_path text NOT NULL CHECK (storage_path <> '' AND storage_path !~ '(^/|:|\|(^|/)\.\.(/|$))'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  media_type text NOT NULL,
  profile_version text NOT NULL,
  state text NOT NULL DEFAULT 'ready' CHECK (state='ready'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(project_id,media_asset_id) REFERENCES media_assets(project_id,id),
  FOREIGN KEY(project_id,media_asset_id,producing_run_id)
    REFERENCES analysis_runs(project_id,media_asset_id,id),
  UNIQUE(project_id,media_asset_id,id),
  UNIQUE(project_id,media_asset_id,producing_run_id,id),
  UNIQUE(project_id,media_asset_id,producing_run_id,artifact_class,storage_path)
);
CREATE INDEX artifacts_asset_idx ON artifacts(project_id,media_asset_id,producing_run_id);

CREATE TABLE media_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  media_asset_id uuid NOT NULL,
  run_id uuid NOT NULL,
  original_artifact_id uuid NOT NULL,
  working_artifact_id uuid NOT NULL,
  timing_map_artifact_id uuid NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  source_duration_ms bigint NOT NULL CHECK (source_duration_ms > 0),
  working_duration_ms bigint NOT NULL CHECK (working_duration_ms > 0),
  working_frame_count integer NOT NULL CHECK (working_frame_count > 0),
  coded_width integer NOT NULL CHECK (coded_width > 0),
  coded_height integer NOT NULL CHECK (coded_height > 0),
  display_width integer NOT NULL CHECK (display_width > 0),
  display_height integer NOT NULL CHECK (display_height > 0),
  working_width integer NOT NULL CHECK (working_width > 0),
  working_height integer NOT NULL CHECK (working_height > 0),
  sample_aspect_ratio text,
  display_aspect_ratio text,
  nominal_frame_rate_num integer CHECK (nominal_frame_rate_num > 0),
  nominal_frame_rate_den integer CHECK (nominal_frame_rate_den > 0),
  average_frame_rate_num integer CHECK (average_frame_rate_num > 0),
  average_frame_rate_den integer CHECK (average_frame_rate_den > 0),
  video_codec text NOT NULL,
  codec_profile text,
  pixel_format text,
  bitrate bigint CHECK (bitrate >= 0),
  container_format text,
  video_stream_count integer NOT NULL CHECK (video_stream_count > 0),
  audio_stream_count integer NOT NULL CHECK (audio_stream_count >= 0),
  selected_video_stream_index integer NOT NULL CHECK (selected_video_stream_index >= 0),
  selected_audio_stream_index integer CHECK (selected_audio_stream_index >= 0),
  audio_codec text,
  audio_sample_rate integer CHECK (audio_sample_rate > 0),
  audio_channels integer CHECK (audio_channels > 0),
  rotation_degrees integer,
  source_start_pts bigint,
  source_time_base_num integer CHECK (source_time_base_num > 0),
  source_time_base_den integer CHECK (source_time_base_den > 0),
  audio_start_pts bigint,
  audio_time_base_num integer CHECK (audio_time_base_num > 0),
  audio_time_base_den integer CHECK (audio_time_base_den > 0),
  rate_mode text NOT NULL CHECK (rate_mode IN ('CFR','VFR','unknown')),
  rate_mode_method text NOT NULL,
  duration_derivation text NOT NULL,
  normalization_profile text NOT NULL,
  probe_evidence jsonb NOT NULL CHECK (jsonb_typeof(probe_evidence)='object'),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(project_id,media_asset_id,run_id) REFERENCES analysis_runs(project_id,media_asset_id,id),
  FOREIGN KEY(project_id,media_asset_id,original_artifact_id) REFERENCES artifacts(project_id,media_asset_id,id),
  FOREIGN KEY(project_id,media_asset_id,run_id,working_artifact_id)
    REFERENCES artifacts(project_id,media_asset_id,producing_run_id,id),
  FOREIGN KEY(project_id,media_asset_id,run_id,timing_map_artifact_id)
    REFERENCES artifacts(project_id,media_asset_id,producing_run_id,id),
  UNIQUE(run_id)
);
CREATE INDEX media_metadata_asset_idx ON media_metadata(project_id,media_asset_id,created_at);

CREATE TABLE temporal_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  media_asset_id uuid NOT NULL,
  run_id uuid NOT NULL,
  working_artifact_id uuid NOT NULL,
  segment_index integer NOT NULL CHECK (segment_index >= 0),
  kind text NOT NULL DEFAULT 'editorial' CHECK (kind='editorial'),
  start_frame integer NOT NULL CHECK (start_frame >= 0),
  end_frame integer NOT NULL CHECK (end_frame > start_frame),
  start_ms bigint NOT NULL CHECK (start_ms >= 0),
  end_ms bigint NOT NULL CHECK (end_ms > start_ms),
  duration_ms bigint GENERATED ALWAYS AS (end_ms-start_ms) STORED,
  segmentation_method text NOT NULL,
  segmentation_version text NOT NULL,
  boundary_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(project_id,media_asset_id,run_id) REFERENCES analysis_runs(project_id,media_asset_id,id),
  FOREIGN KEY(project_id,media_asset_id,run_id,working_artifact_id)
    REFERENCES artifacts(project_id,media_asset_id,producing_run_id,id),
  UNIQUE(run_id,segment_index),
  UNIQUE(project_id,media_asset_id,run_id,id)
);
CREATE INDEX temporal_segments_asset_time_idx ON temporal_segments(project_id,media_asset_id,run_id,start_frame);

CREATE TABLE representative_frames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  media_asset_id uuid NOT NULL,
  run_id uuid NOT NULL,
  segment_id uuid NOT NULL,
  image_artifact_id uuid NOT NULL,
  working_frame_index integer NOT NULL CHECK (working_frame_index >= 0),
  timestamp_ms bigint NOT NULL CHECK (timestamp_ms >= 0),
  source_pts bigint,
  source_time_base_num integer CHECK (source_time_base_num > 0),
  source_time_base_den integer CHECK (source_time_base_den > 0),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  extraction_method text NOT NULL,
  extraction_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(project_id,media_asset_id,run_id,segment_id)
    REFERENCES temporal_segments(project_id,media_asset_id,run_id,id),
  FOREIGN KEY(project_id,media_asset_id,run_id,image_artifact_id)
    REFERENCES artifacts(project_id,media_asset_id,producing_run_id,id),
  UNIQUE(segment_id),
  UNIQUE(run_id,working_frame_index)
);
CREATE INDEX representative_frames_asset_idx ON representative_frames(project_id,media_asset_id,run_id);
