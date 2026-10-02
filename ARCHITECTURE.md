# ARCHITECTURE.md

**Status:** Planning revised to approved MVP decisions; implementation not started  
**Version:** 0.2

## 1. Architectural decision

**Separate the web application from durable background processing.**

| Component | Responsibility |
|---|---|
| Next.js / React / TypeScript / Tailwind | Planned interface, project review, playback; login deferred from Phase 0 |
| Next.js server endpoints | Local-mode/project checks, validation, job submission, storage access |
| Identity adapter / Supabase Auth later | Local owner context without login; authenticated identity before multi-user production |
| PostgreSQL, local or Supabase-hosted | Projects, analysis, EDL versions, job state; hosted Supabase is optional locally |
| Storage adapter, local filesystem first | Originals, working derivatives, and exports; compatible with private Supabase/cloud storage later |
| Background worker | Media processing, AI calls, EDL generation, rendering |
| FFmpeg / ffprobe | Probe, normalization, extraction, scene detection, composition |
| OpenAI API | Transcription, visual interpretation, story and edit proposals |
| Remotion | Deferred beyond Phase 1; no Phase 0/1 dependency |

Heavy work must never depend on a browser session or run inside a short-lived web request.

The initial worker can be one separately deployed container application with analysis and rendering job handlers. Independent scaling can follow without introducing many services upfront.

Phase 0 supports explicit local single-user development without login. Bind local services to loopback and enforce local-origin/project checks; the no-login mode must not be enabled for multi-user production. Keep owner fields without requiring an authentication-provider record. Authentication and RLS hardening are deployment gates, not Phase 0 prerequisites.

Use a PostgreSQL polling/claiming worker. Redis and BullMQ are excluded throughout the MVP. Embeddings and vector search are also excluded throughout the MVP. The repository layout is a future plan: this revision does not authorize application scaffolding or dependency installation.

## 2. Upload and analysis pipeline

1. Resolve the local owner context or deployed identity, check project access, and reserve upload capacity.
2. Transfer resumably through the local storage adapter or directly to private cloud storage.
3. Finalize the upload through the backend.
4. Verify the stored object and inspect real media properties.
5. Reject unsupported or excessive media before expensive processing.
6. Create a normalized working video and lightweight preview.
7. Detect candidate scene boundaries.
8. Extract audio, frames, and technical quality measurements.
9. Transcribe speech and analyze representative frames.
10. Build evidence-linked searchable segments.
11. Publish the completed analysis revision.

Use resumable uploads in both storage modes. The local adapter persists resumable transfer state and bounded chunks; the precise local transfer library remains to be selected. Cloud mode can use Supabase TUS. Hosted Supabase Free limits must not block local development. [Source: Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)

### Configurable admission and upload reservations

PRD limits are configuration defaults, not constants embedded in schemas or business logic. Validate configuration and record its version per reservation/job. Apply new configuration to new admissions; do not invalidate prior accepted assets or silently rewrite existing versions. A changed operator spending ceiling is checked before every new paid stage, including resumed jobs.

Atomically reserve file slots and declared bytes against committed usage plus unexpired reservations. Scope the reservation/finalization idempotency key to the project. Track object key, expiry, transferred bytes, and state. Interrupted transfers reuse the reservation; renewal rechecks capacity. Finalization verifies size/checksum and converts reserved bytes to committed usage once. Cancellation/expiry releases unused capacity and queues incomplete-object cleanup. Probe actual duration and atomically admit it against committed project duration before expensive analysis; concurrent finalizations cannot exceed the configured duration quota. Rejected media releases its capacity and is scheduled for removal. Never trust client-reported duration for final admission.

Maintain separate budgets for original bytes, durable derivatives/exports, and temporary disk. Reserve estimated headroom before transcodes and fail or pause clearly if capacity is unavailable.

### Storage and retention contract

The storage adapter exposes logical keys, metadata/checksum lookup, bounded reads/writes, resumable intake, deletion, and controlled playback access. Stored references carry a backend and logical namespace/key, never machine-specific absolute paths or signed URLs. Cloud publication is not assumed to support filesystem rename: publish a verified immutable object first, then transactionally mark its artifact ready using the current lease token.

| Storage class | Contents and lifecycle |
|---|---|
| Originals | Immutable accepted uploads, retained until explicit eligible asset/project deletion |
| Working media | Normalized videos, proxies, frames, analysis audio, timing maps; reusable and versioned |
| Temporary media | Attempt-specific chunks, decode/intermediate files, incomplete outputs; never exposed as completed artifacts |
| Final exports | Verified immutable MP4/SRT artifacts linked to EDL/render versions; retained for version history |

Preserve all artifacts and analysis revisions referenced by retained stories/EDLs/renders. Asset removal is blocked while retained versions depend on it; removing unused assets or deleting the whole project is explicit. Orphan cleanup must traverse references and respect active leases. Temporary cleanup runs after success, failure, cancellation, and pause checkpoints where files are not needed; restart recovery sweeps abandoned attempts after lease/age checks. A durable checkpoint cannot depend on disposable temporary files. Unreferenced derivative expiry is configurable; it must never silently break historical playback or restoration.

### Normalized working media

Maintain three distinct artifacts:

- **Original:** Immutable uploaded file.
- **Working video:** SDR H.264 MP4, yuv420p, square pixels, constant 30 fps, rotation applied, original display proportions preserved, even dimensions, configurable longest-edge cap defaulting to 1920 pixels; do not upscale during normalization.
- **Preview proxy:** Lower-resolution H.264 MP4 derivative on the same timeline, with an explicit mapping if any timing differs.

Analysis timestamps and EDL source ranges use the working-video timebase. Store original stream timebases/start PTS, normalization profile/version, working frame count, and a per-frame original-video PTS mapping, including dropped/duplicated VFR frames. Do not claim an exact inverse for discarded original frames. Frame n has working time n/30 seconds; millisecond labels are display values, not a second timing source of truth.

Preserve audio/video offsets during normalization. Do not independently reset audio and video in a way that changes synchronization.

Set working time zero to the first retained displayed video frame. Map audio onto that common origin: discard audio preceding it, insert leading silence for delayed audio, and pad/trim to the normalized video duration. Working audio, when present, is AAC 48 kHz stereo; use PCM 48 kHz stereo for decoded render intermediates. Keep no-audio/no-speech metadata distinct from inserted silence. Analysis audio defaults to mono 16 kHz PCM, compressed or chunked for provider upload, with chunk origin, overlap, codec delay, and effective timestamp offsets recorded. Final MP4 uses H.264/yuv420p at 30 fps and AAC 48 kHz stereo. Encoder delay must be accounted for in verification.

This intentionally prioritizes reproducible 1080p-class MVP exports over original-resolution mastering.

### Scene and frame policy

Configurable starting policy, tuned during Phase 0 and saved with each analysis revision:

- Detect visual shot changes.
- Treat a continuous recording as a valid single scene.
- Split long scenes into search segments, default maximum ten seconds.
- Extract a midpoint frame per segment and extra boundary frames where useful.
- Default vision input cap: 300 frames per project, allocated deterministically across eligible assets/segments. Record unsampled intervals and coverage; do not fabricate observations for them.
- If the cap reduces sampling density, record and display that limitation.

Scene boundaries are candidates, not guaranteed edit points. Transcript boundaries help avoid cuts in the middle of sentences.

### Transcription policy

Use an OpenAI transcription configuration that actually provides the required timestamp granularity. Do not assume every transcription model has interchangeable output fields.

The current documentation limits `timestamp_granularities[]` to `whisper-1` and describes a 25 MB transcription-upload limit. Use compressed audio or bounded chunks, preserve chunk offsets, and reconcile overlapping boundaries. Recheck these constraints when implementation begins. [Source: OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text)

Initial baseline: `whisper-1` with timestamped output, subject to Thai/English benchmark results. Keep the provider adapter replaceable.

No-audio and no-speech results are valid outcomes, not processing failures.

### Search policy

Start with:

- Indexed English transcript/description search.
- Thai substring and trigram-assisted matching.
- Filters for asset, speech presence, quality warnings, and tags.

Include metadata, tags, transcript, and description keywords. No embeddings, vector columns/indexes, or vector service in the MVP. Full-text search alone must not be assumed sufficient for Thai; tune the keyword baseline against the labeled retrieval benchmark.

### Analysis caching and invalidation

Persist stage cache keys from project scope, immutable input content/artifact hashes, relevant normalization/sampling parameters, and pipeline/model/prompt/schema versions. Reuse only completed, checksum-verified results with matching keys. Retry only incomplete or invalidated stages; changed sampling must not automatically retranscribe unchanged audio. Reopening, search, new briefs, EDL edits, ratio/caption changes, and render retries do not trigger footage re-analysis. Explicit force-reruns record the reason and require the same spending checks, producing a new revision. Ordinary duplicate submissions coalesce through idempotency; do not share private analysis across projects implicitly.

## 3. Story and EDL pipeline

1. Capture the user's objective, audience, and target duration; Phase 1 uses 9:16 only, with ratio selection added in Phase 2.
2. Freeze a snapshot of eligible analysis revisions.
3. Retrieve relevant footage segments.
4. Ask the model for three structured story proposals.
5. Validate every referenced asset and interval.
6. Show complete, valid options.
7. Record the selected story.
8. Generate a candidate EDL using allowed source IDs.
9. Resolve and quantize timing deterministically.
10. Validate the EDL.
11. Save an immutable version.
12. Queue rendering.

Structured Outputs help enforce output shape, but can still contain substantive mistakes. Source ownership, timestamp validity, duration, and supported operations therefore require application validation. [Source: OpenAI structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

## 4. Rendering pipeline

The renderer accepts **only a validated EDL**, never arbitrary model-generated commands.

For each clip:

1. Resolve its authorized working-video artifact.
2. Decode and trim its source interval.
3. Apply the saved crop or fit behavior.
4. Normalize output dimensions, frame rate, and audio format.
5. Insert silence when the clip has no usable audio.
6. Concatenate clips with hard cuts.
7. Add subtitles when enabled in Phase 2.
8. Encode MP4 with fast-start metadata.
9. Verify the output.
10. Publish the completed artifact atomically.

FFmpeg provides the required trim, scale, pad, subtitle, and concatenation filters. The implementation must reset per-segment timestamps appropriately and normalize stream properties before concatenation. [Source: FFmpeg filters documentation](https://ffmpeg.org/ffmpeg-filters.html)

Post-render verification includes:

- Expected streams and dimensions.
- Duration tolerance.
- Successful full-file decoding.
- File size and checksum.
- Output tied to the requested EDL version.

A failed verification is a failed render, even if a file exists.

### Aspect ratio behavior

- Phase 1: 1080 × 1920 (9:16), fit the full image without stretching, centered black padding, including landscape/square sources. Uniform upscaling for final output is permitted and indicated as a quality limitation.
- Phase 2 adds 1080 × 1080 (1:1) and 1920 × 1080 (16:9).
- Phase 2 optional crop: saved normalized rectangle in the rotation-corrected working image, constrained to source bounds and output proportions; no automatic or silent crop.
- No claim of reliable automatic face tracking in the MVP.
- Changing ratio creates a new version and recomputes framing and subtitle layout.

### Remotion decision

FFmpeg is the only required media/rendering engine for Phase 0 and Phase 1. Remotion is deferred beyond Phase 1 and is not a prerequisite for later MVP features either.

Introduce Remotion only if later title or motion templates justify it. It must consume the same EDL through an explicit adapter and pass the same output tests.

## 5. Natural-language editing

1. Capture the instruction and base EDL version.
2. Supply relevant footage evidence and supported operation definitions.
3. Generate an allowlisted edit proposal.
4. Resolve target clips and source references.
5. Validate the proposal and resulting EDL.
6. Show the change summary.
7. Apply after the user chooses **Apply and render**.
8. Save a new immutable version.
9. Render and preserve the old output.

Supported operation types:

- Remove clip.
- Reorder clips.
- Trim clip.
- Replace source range.
- Set aspect ratio or framing.
- Enable/disable subtitles.
- Correct caption text.
- Set clip mute/gain within permitted limits.

A stale proposal must not overwrite a newer version. Return a version conflict and regenerate the proposal against the current edit.

## 6. Durable jobs

Use PostgreSQL-backed job records and a polling worker throughout the MVP. Claim eligible jobs atomically using row locking and skip locked rows; no Redis or BullMQ. Jobs with incomplete dependencies, pauses, or cancellation requests are not claimable.

Required mechanics:

- Atomic job claiming with row locking.
- Lease expiry and worker heartbeat.
- Attempt counter and bounded retries.
- Exponential backoff for transient failures.
- Idempotency keys.
- Dependency tracking.
- Cancellation checks between expensive stages.
- Persisted progress and error codes.

Submission and the relevant application-state transition occur in one database transaction.

Job states:

`queued`, `running`, `retry_wait`, `pause_requested`, `paused`, `succeeded`, `failed`, `cancel_requested`, `cancelled`.

Queued/retry-wait jobs can pause immediately; running jobs enter `pause_requested` and persist a durable checkpoint before `paused`. Store the pause reason (`user`, `budget`, `capacity`, or `dependency`) and resume requirements. Resume revalidates project existence, dependencies, capacity, and budget before returning to `queued`, reusing completed stages. A failed/cancelled prerequisite pauses its dependents with a visible reason; resuming requires the prerequisite to be repaired/replaced. Cancellation takes precedence over pause: idle jobs become cancelled immediately, active jobs enter `cancel_requested` and stop at the next checkpoint. Long subprocesses have timeouts and termination handling; already-sent provider requests may still incur charges. Cancelled jobs do not auto-resume; explicit retry creates a linked job while safely reusing valid stage artifacts. Never publish after cancellation, deletion, or loss of lease. User pause/resume does not reset the bounded retry budget.

Assume at-least-once execution. Workers must safely reuse completed artifacts and avoid publishing duplicates.

Use attempt-specific temporary paths and a lease token when publishing. A worker whose lease expired cannot publish over its replacement.

Provider requests may still be charged twice after an uncertain network failure; log these cases rather than promising exactly-once external billing.

## 7. Security and privacy

- Phase 0: loopback-only local mode, controlled media routes, scoped local paths, and project-reference checks; no login or production RLS prerequisite.
- Before multi-user production: authenticated ownership checks on every endpoint/job, private cloud buckets, and short-lived playback/download access.
- Before multi-user production: Row Level Security on user-accessible project data and cross-user database/API/search/storage tests. [Source: Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- OpenAI and privileged storage credentials remain server-side.
- Treat transcripts, filenames, and visible text as untrusted content.
- Never execute instructions found inside footage.
- Never concatenate AI output into shell commands.
- Restrict worker file access to its job directory.
- Enforce CPU, memory, disk, duration, and subprocess time limits.
- Do not expose arbitrary URL ingestion in the MVP.
- Do not place transcript text or signed URLs in general logs.

Deletion immediately blocks new application access/publication, cancels jobs, and queues artifact removal. MVP target: active application artifacts removed within 24 hours. Previously issued cloud URLs and client copies require an explicit expiry/revocation policy; do not promise immediate erasure of downloaded copies. Backup and provider-retention policies must be documented before a public pilot. Phase 0 temporary cleanup is mandatory independently of later complete project-deletion UX.

## 8. Observability and cost controls

Record per job:

- Project, asset, stage, and attempt IDs.
- Queue time and execution time.
- Input/output media duration.
- Model and prompt versions.
- Token/audio usage where available.
- Estimated provider cost.
- Error category and retry outcome.
- Artifact checksums.

Phase 0 requires configurable project limits, sampling, API spending guardrails, bounded retries, subprocess timeouts, concurrency limits, and temporary cleanup. Atomically reserve a conservative bounded-stage cost against spent plus outstanding reservations before sending API requests. Reconcile measured usage afterward; keep uncertain requests accounted for until reconciled. Missing cost configuration or insufficient budget pauses paid work with a visible reason. Every retry rechecks/reserves its potential cost. These are application guardrails, not a guarantee of exact provider billing.

Configure an overall active-job ceiling and separate analysis/render ceilings, initially one active heavy job overall and one render maximum. Enforce limits across worker claims, not independently per process. Configure stage timeouts, maximum attempts, backoff, disk headroom, and abandoned-temp age; record effective values with benchmarks before enabling paid runs.

## 9. Technical risks

| Risk | Consequence | Mitigation / proof |
|---|---|---|
| Variable frame rate, rotation, audio offsets | Drift or incorrect cuts | Canonical media and synchronization fixtures |
| Frame sampling misses important activity | Incomplete understanding | Coverage indicators and source inspection |
| AI invents clips or events | Unrenderable or misleading story | Evidence references and semantic validation |
| Thai transcription errors | Wrong story or subtitles | Thai fixtures and editable transcript/captions |
| Shortened speech loses meaning | Misleading edit | Sentence-boundary preference and context review |
| Worker interruption | Lost or duplicate output | Leases, idempotency, atomic publication |
| Expensive vision/transcoding | Unacceptable cost or latency | Input caps, cached artifacts, measured budgets |
| Crop removes the subject | Unusable export | Safe fit default and crop preview |
| Model refusal or malformed response | Blocked workflow | Typed failure, bounded retry, retained prior state |

Vision descriptions must remain inspectable and uncertain where appropriate; OpenAI explicitly documents visual interpretation limitations. [Source: OpenAI images and vision](https://developers.openai.com/api/docs/guides/images-vision)

## 10. Proposed repository structure

The future repository root will contain the five approved Markdown documents.

| Path | Purpose |
|---|---|
| `apps/web/` | Next.js UI and thin server endpoints |
| `apps/worker/` | Job execution and FFmpeg orchestration |
| `packages/contracts/` | Shared schemas, EDL types, validation |
| `packages/ai/` | OpenAI adapters, prompts, response handling |
| `packages/media/` | Timing, probing, normalization, render planning |
| `packages/db/` | Database access and generated types |
| `packages/storage/` | Local filesystem and later private cloud adapters |
| `supabase/migrations/` | PostgreSQL schema/indexes/job functions usable locally; deployed RLS added before multi-user production |
| `tests/unit/` | Timing, scoring, validation, patch behavior |
| `tests/integration/` | Storage, jobs, providers, renderer |
| `tests/e2e/` | User workflow tests |
| `tests/fixtures/` | Small licensed or synthetic test media |
| `references/` | Lowercase reference directory; provenance/rights manifest planned; large media tracking policy to be decided |
| `infra/` | Worker container and deployment configuration |

## 11. Remaining decisions and explicit exclusions

- Before implementation setup: worker language/runtime and pinned package/tool versions; local PostgreSQL provisioning and resumable-upload library.
- Before paid benchmarks: exact vision/story model, prompt versions, benchmark hardware, numeric spending/retry/timeout/disk/cleanup settings, representative fixture inventory/rights, mixed-language scoring/threshold, and versioned text-normalization/reviewer rubrics.
- Before multi-user production: hosting, authenticated login method, RLS policies, cloud storage plan, backup/provider retention, and issued-URL expiry/revocation policy.
- Beyond MVP: embeddings/vector search, HEVC/HDR expansion, music/voiceover/overlapping tracks, collaboration, billing, desktop packaging, and automatic subject tracking. GPU processing is optional future work.
- Beyond Phase 1 only, if separately justified: Remotion. FFmpeg remains sufficient for the planned MVP.
- Quotas may change through validated configuration; larger workloads require capacity evaluation, not an architectural rewrite.

Canonical timing, project boundaries, EDL validation/versioning, analysis caching, and retry-safe job recovery are not postponed. Phase 0 authentication is intentionally deferred. This is a planning-only revision; implementation has not begun.
