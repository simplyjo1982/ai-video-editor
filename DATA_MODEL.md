# DATA_MODEL.md

**Status:** Planning revised to approved MVP decisions; implementation not started  
**Version:** 0.2

## 1. Shared conventions

- Entity identifiers: UUIDs.
- Application timestamps: UTC.
- Media timestamps: integer milliseconds on the normalized working video.
- Render timeline: integer frames at 30 fps.
- Time intervals: inclusive start, exclusive end.
- Stored artifact references: backend, logical namespace, and object key; local paths resolve under a configured root and cloud namespaces map to buckets. Never persist signed URLs or machine-specific absolute paths as artifact identity.
- Analysis, storyboards, and EDLs carry explicit schema/version identifiers.
- Every project-owned row includes `project_id`.
- Cross-entity references must belong to the same project.
- Phase 0 uses a persisted local owner UUID without login or an Auth-provider foreign-key requirement. Future authenticated owner mapping is explicit; do not silently assign local projects to whichever user first logs in. Authentication and production RLS are required before multi-user production, not before Phase 0.
- Project limits and sampling/cost/resource policies are versioned configuration values, not hard-coded database limits. EDL v1 retains its fixed 30 fps timing contract.
- Search uses metadata, tags, transcript, and keyword indexes only; no embeddings/vector fields. PostgreSQL jobs require no Redis/BullMQ data structures. FFmpeg is the only required Phase 0/1 renderer; Remotion is deferred beyond Phase 1.

## 2. Core entities

| Entity | Main fields and purpose |
|---|---|
| `projects` | Local/authenticated owner context, name, brief, language preferences, target duration, active EDL, policy version, deletion state |
| `policy_versions` | Validated project limits, sampling settings, spending ceilings, concurrency/retry/timeouts, storage/cleanup policies; immutable configuration snapshots |
| `upload_reservations` | Project, intake idempotency key, artifact key, reserved slots/bytes, actual bytes/duration, expiry, finalization state, policy version |
| `assets` | Project, original filename, checksum, upload state, original artifact, active analysis revision |
| `media_metadata` | Asset, original/working artifact IDs, duration/frame count, codecs, dimensions, rotation, audio offsets, stream timebases and start PTS, normalization profile/version, timing-map artifact |
| `artifacts` | Project, asset/job linkage, original/working/temporary/export class, backend/namespace/key, checksum, size, status, profile version, producing attempt, retention/reference information |
| `analysis_runs` | Asset, immutable input hashes, pipeline/model/prompt/schema versions, sampling policy, stage cache keys/results, coverage, errors, rerun reason |
| `scenes` | Analysis run, source start/end, detector confidence, boundary type |
| `segments` | Analysis run, scene, source range, summary, tags, search text |
| `frames` | Analysis run, segment, source timestamp, image artifact, sampling reason |
| `transcript_segments` | Analysis run, source range, text, language, optional provider confidence |
| `transcript_words` | Transcript segment, word, source start/end; optional where supported |
| `visual_observations` | Segment, description, uncertainty, supporting frame IDs |
| `quality_scores` | Segment, component scores, overall score, warnings, scoring version |
| `storyboard_sets` | Project, brief snapshot, analysis snapshot, status |
| `storyboards` | Set, option index 1–3, title, angle, hook, estimated duration |
| `storyboard_beats` | Storyboard, order, narrative purpose, source references, rationale |
| `edl_versions` | Project, unique version number, parent version, storyboard, schema version, immutable EDL JSON, document hash, render-content hash |
| `edit_requests` | Project, base EDL, instruction, proposal, status, resulting EDL |
| `renders` | EDL, output profile, renderer version, status, artifact, validation results |
| `jobs` | Type, target, dependencies, state, pause reason/resume requirements, checkpoint, lease token/expiry/heartbeat, attempt/max attempts, retry time, idempotency key, policy version, progress/error, linked retry job |
| `cost_reservations` | Project/job/stage/attempt, estimated amount, provider/pricing version, reserved/reconciled/uncertain/released status, actual usage linkage |
| `usage_events` | Project/job, provider, model, usage quantities, estimated cost |

Provider confidence is nullable. Do not invent numerical confidence when none is available.

Originals, working media, temporary files, and final exports have separate accounting. Durable stage results identify immutable artifacts and must not depend on disposable temp paths. Storage migration verifies content hashes and changes location metadata without altering source timing/content identity or historical EDLs.

### Reservation integrity

- Reserve file slots/bytes transactionally against accepted usage plus live reservations; enforce a project-scoped unique intake idempotency key.
- Reservation states: `reserved`, `uploading`, `uploaded`, `accepted`, `rejected`, `expired`, `cancelled`. Transfer completion alone is not media acceptance.
- Record configurable expiry/renewal; retries reuse the same reservation/object. Finalization verifies checksum/size and accounts bytes exactly once. Post-probe duration admission is atomic before expensive analysis.
- Rejection, cancellation, or expiry releases capacity once and queues incomplete/rejected media cleanup. Keep pending-deletion disk usage visible until actual removal.
- Cost admission is atomic against spent plus outstanding/uncertain reservations. Resume/retry checks the current operator ceiling; historical job policy snapshots remain unchanged. Unknown cost cannot silently bypass the guardrail.

## 3. Relationships and integrity

- Project → many assets.
- Asset → many analysis revisions; one active revision.
- Analysis revision → scenes, segments, frames, transcripts, observations, scores.
- Storyboard set → exactly three options when marked complete.
- Storyboard beat → one or more grounded source references.
- Project → many immutable EDL versions.
- EDL → many render attempts/output artifacts.
- Edit request → one base EDL and, if applied, one resulting EDL.

Required constraints:

- All source intervals have `start < end`.
- Source intervals stay within the relevant working media.
- No cross-project source references.
- Unique storyboard option index per set.
- Unique EDL version number per project.
- Unique job idempotency key within its defined scope.
- Deleting or replacing an asset cannot silently change an existing edit.
- Block individual removal of assets/artifacts referenced by retained storyboards, EDLs, or renders. Explicit project deletion removes the dependency graph; unrelated orphan cleanup cannot invalidate history.
- Enforce same-project foreign-key relationships, not only application checks, where relational references permit them; semantically validate references inside JSON before publication.

## 4. EDL v1 contract

The stored EDL JSON is the **rendering source of truth**.

| Section | Required contents |
|---|---|
| Identity | Schema version, project ID, EDL version, parent version |
| Provenance | Selected storyboard, analysis revisions, creation reason |
| Output | Phase 1: 1080 × 1920 (9:16), 30 fps, total frame count; Phase 2 adds 1080 × 1080 and 1920 × 1080 |
| Clips | Ordered clip IDs, asset IDs, working artifact IDs, source ranges, timeline ranges |
| Framing | Phase 1 centered safe fit/black padding preserving proportions; Phase 2 optional saved normalized crop rectangle |
| Audio | Source audio enabled, mute/gain, silence fallback |
| Captions | Enabled flag, styling preset, output-timeline cues; disabled with empty cues in Phase 1, enabled/correctable in Phase 2 |
| Restrictions | Hard cuts, one video stream, source audio only, no speed changes |

Each clip includes:

- Stable `clip_id`.
- Authorized `asset_id` and immutable `working_artifact_id`.
- `source_in_frame` and `source_out_frame`.
- `timeline_start_frame`.
- `duration_frames`.
- Source segment/transcript references.
- Framing configuration.
- Audio configuration.

### Timing invariants

Because working media and output both use 30 fps:

- `duration_frames = source_out_frame − source_in_frame`.
- First clip starts at timeline frame zero.
- Each following clip starts at the previous clip’s end.
- Total output frames equal the sum of clip durations.
- No gaps, overlaps, speed changes, or implicit transitions.

Validate proposed ranges first, then convert nonnegative integer milliseconds once using `frame = floor(ms × 30 / 1000 + 0.5)` (nearest frame, ties upward). The exclusive end may equal the working frame count. Reject empty/out-of-range results rather than silently clamping or inventing replacement timing.

Record realized timestamps so UI labels match what the renderer uses.

### Canonical media and timestamp mapping

- Working video: SDR H.264/yuv420p MP4, square pixels, rotation applied, 30 fps, even dimensions, preserved display proportions, configurable longest-edge cap default 1920, no normalization upscaling.
- Working time zero is the first retained displayed video frame. Store a map from each working frame to original video PTS and original stream timebase, including duplicated/dropped-frame decisions; mapping is not assumed invertible for VFR sources.
- Store common audio/video origin and offset adjustments. Trim audio before video origin, insert silence for late audio, and pad/trim to working-video duration. Working/final audio: AAC 48 kHz stereo; decoded render intermediate: PCM 48 kHz stereo. Preserve original no-audio/no-speech facts.
- Analysis audio defaults to mono 16 kHz PCM with compressed/chunked upload derivatives; store each chunk's working origin, overlap, and effective encoder-delay correction. Reconcile overlaps before publishing transcript times.
- Proxy playback shares the working timeline or supplies an explicit map. Frame time n/30 is authoritative; integer-millisecond labels cannot be round-tripped to redefine the edit.

Example: source frames [30, 90) produce 60 output frames at timeline start 0. A second clip with source [0, 30) starts at output frame 60; total output is 90 frames (3 seconds). An exclusive end beyond the working frame count or an interval that quantizes to zero frames is invalid. This arithmetic example is shorter than the configured default export minimum and is not a product-valid complete EDL.

## 5. Caption contract

Captions contain:

- Cue ID.
- Output start/end frames.
- Text.
- Language.
- Source transcript reference.
- Manual-correction flag.

For a retained source interval, intersect each transcript cue with that interval and map the intersection onto the output timeline.

Requirements:

- Never emit text from a removed interval.
- No cue extends past output duration.
- Avoid overlapping cues in the single caption track.
- If a cut bisects a cue without adequate word timing, flag it for correction or choose a safer cut.
- Caption corrections preserve the original transcription as a separate record.
- Caption corrections affect that EDL's output cues, not the source analysis or search index, and never trigger transcription. Source transcript correction/re-indexing is a separate future decision.
- Ratio changes recompute line wrapping and placement.
- Thai shaping and font coverage must pass visual QA.

## 6. Versioning and invalidation

- Necessary or explicitly requested analysis reruns create a new revision and record the cause. Identical ordinary submissions reuse completed valid analysis instead.
- Existing storyboards and EDLs retain their original analysis references.
- New stories use an explicit latest-ready analysis snapshot.
- Applying an edit creates a new EDL; it never overwrites the old one.
- Restoring an earlier edit creates a new version referencing that content.
- Keep a document hash for the entire immutable EDL and a separate canonical render-content hash excluding version IDs, creation timestamps, and non-rendering rationale/provenance. Include all rendering-affecting clip order/ranges, output settings, captions, crop, audio, working-artifact hashes, renderer/toolchain/profile/font versions in the render key.
- Matching valid renders may be reused.
- Changes to captions, crop, audio, or aspect ratio change the render key.
- Analysis cache keys include project scope, input hashes, relevant stage settings, and pipeline/model/prompt/schema versions. Cache hits require verified available artifacts. Failed/incomplete stages are retried independently; a changed visual sampling policy does not invalidate unchanged transcription.
- Story regeneration, clip edits, ratio changes, caption correction, reopening, and render retry do not invalidate source analysis. No implicit cross-project private cache sharing.
- Preserve original media and dependencies pinned by retained versions; clean only unreferenced derivatives according to policy. Temporary media is attempt-specific and cleaned without deleting durable checkpoints or valid exports.

## 7. State rules

Asset states:

`uploading`, `uploaded`, `validating`, `analyzing`, `ready`, `partial`, `failed`, `rejected`.

A `partial` asset remains inspectable. It becomes story-eligible only when mandatory visual/timing analysis is complete and any missing speech transcription is explicitly excluded by the user.

Mandatory story eligibility means a verified working artifact and timing map, scene/segment intervals, valid representative-frame artifacts, and evidence-linked visual results for candidate intervals. Unsampled/unanalyzed intervals are not silently treated as understood. No-audio/no-speech is a completed valid outcome. Missing speech transcription requires a recorded user exclusion; failed quality components remain nullable with renormalized scores. Readiness is separate from its current job's pause/cancellation state.

Job states:

`queued`, `running`, `retry_wait`, `pause_requested`, `paused`, `succeeded`, `failed`, `cancel_requested`, `cancelled`.

- Poll/claim only eligible queued/retry-wait jobs whose dependencies succeeded, retry time has arrived, and concurrency capacity is available.
- Pause idle jobs immediately; running jobs checkpoint through `pause_requested` to `paused`. Persist `user`, `budget`, `capacity`, or `dependency` reason.
- Resume to queued only after dependency, project, budget, and capacity checks. Keep completed stages and attempt accounting.
- Cancellation wins over pause, blocks publication, and terminates at a safe checkpoint or subprocess timeout. Cancelled jobs need an explicit linked retry, not automatic resumption.
- A failed/cancelled dependency pauses dependent jobs until repaired/replaced. Lease expiry allows recovery only if pause/cancellation/deletion state permits it.
- Idempotency and current lease token guard all publication; a superseded worker cannot mark artifacts or revisions ready.

Edit request states:

`interpreting`, `needs_clarification`, `proposed`, `invalid`, `applied`, `superseded`, `failed`.

Render states:

`queued`, `rendering`, `validating`, `paused`, `ready`, `failed`, `cancelled`.

A render becomes `ready` only after output verification and successful storage publication. Pending pause/cancel requests are displayed from its job; entering a durable pause marks the render paused. On resume, the job checkpoint determines the next render stage. Older ready artifacts remain available. Phase 0 has no final-export prerequisite; these contracts are established for Phase 1 FFmpeg rendering.
