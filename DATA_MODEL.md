# DATA_MODEL.md

**Status:** Phase 0A–0D completed; version 0.3 planning revision only; Phase 0E not started

**Version:** 0.3

## 1. Shared conventions

- Entity identifiers: UUIDs.
- Application timestamps: UTC.
- Original technical facts: exact integer PTS plus rational stream timebase and explicit origin. Published downstream intervals: integer working-frame indexes at 30 fps, with integer milliseconds only for display/provider interchange; every provisional interval names its coordinate system.
- Render timeline: integer frames at 30 fps.
- Time intervals: inclusive start, exclusive end.
- Stored artifact references: backend, logical namespace, and object key; local paths resolve under a configured root and cloud namespaces map to buckets. Never persist signed URLs or machine-specific absolute paths as artifact identity.
- Analysis, storyboards, and EDLs carry explicit schema/version identifiers.
- Every project-owned row includes `project_id`.
- Cross-entity references must belong to the same project.
- Phase 0 uses a persisted local owner UUID without login or an Auth-provider foreign-key requirement. Future authenticated owner mapping is explicit; do not silently assign local projects to whichever user first logs in. Authentication and production RLS are required before multi-user production, not before Phase 0.
- Project limits and sampling/cost/resource policies are versioned configuration values, not hard-coded database limits. EDL v1 retains its fixed 30 fps timing contract.
- Search uses metadata, tags, transcript, and keyword indexes only; no embeddings/vector fields. PostgreSQL jobs require no Redis/BullMQ data structures. FFmpeg is the only required Phase 0/1 renderer; Remotion is deferred beyond Phase 1.

## 2. Existing schema and staged additions

**Product:** AI Creative Director + AI Video Editor. This is a design contract, not a request to create every future table.

The implemented migrations are `packages/db/migrations/0001_phase_0b.sql`, `0002_project_status.sql` and `0003_upload_reservations.sql`. They provide `projects`, `media_assets`, `jobs`, `analysis_runs` and `upload_reservations` (plus migration bookkeeping). Use the existing name `media_assets`, not a new parallel `assets` table. Preserve applied migrations and current rows.

### Minimum additive schema plan for Phase 0E

Create these changes only when Phase 0E implementation is separately authorized. No migration is created/applied in this revision.

| Structure | Minimum justified fields / change | Why needed in 0E |
|---|---|---|
| Existing `media_assets` | Preserve filename, logical original path, size and nullable duration/dimensions/codec; add verified original checksum and technical-analysis pointer/status as needed; record admitted duration and policy snapshot atomically | Stable source identity, compatibility and concurrent duration admission; legacy fields are convenience projections, not competing technical truth |
| Existing `analysis_runs` | Retain project/asset/type/revision/model/prompt/schema/hash/cache fields; add toolchain/configuration snapshot, upstream run/artifact references, completion/error/coverage summary and linked job as needed | Separate immutable successful results for probe, normalization, temporal segmentation and representative frames; model/prompt fields remain null for deterministic runs |
| `artifacts` | UUID, project/asset, producing run/job, class, backend/namespace/key, SHA-256, bytes, media type, profile/version, state, created time | Verified immutable original references and working videos, timing maps and representative images; attempt-local temp files need no permanent artifact row |
| `media_metadata` | UUID, project/asset/run, original artifact and optional working/map artifact references, schema version, canonical technical fields, bounded raw probe evidence, derivation/warnings | Preserve original facts separately from derived working properties and allow future reprocessing without overwriting history |
| `temporal_segments` | UUID, project/asset/run, working artifact, optional same-asset parent, kind, start/end frames, detector/method version, nullable confidence, boundary reason | One table for shot/editorial intervals in 0E and later justified scene grouping; avoid separate scenes/shots tables now |
| `representative_frames` | UUID, project/asset/run/segment, image artifact, working frame index, mapped original PTS/timebase, extraction policy and reason | Persistent representative samples with verifiable evidence coordinates for later visual/semantic layers |
| Existing `jobs` | Reuse states, attempts, lock/lease/heartbeat, idempotency and pause fields; add checkpoint, dependency/target-run linkage and policy snapshot only for technical handlers | Durable technical stages with atomic claiming, bounded retries, lease-safe publication, pause/resume and cancellation |

Canonical technical fields include: original/container and selected-stream duration with derivation; coded/display width and height; sample/display aspect ratio; rotation/orientation; codec/profile; rational nominal/average frame rate; CFR/VFR/unknown plus inspection method/coverage; audio stream indexes/codecs/channels/sample rates/start PTS/timebases; selected stream indexes; normalization profile/version/status; working duration/frame count/dimensions; shared A/V origin and offsets; and timing-map artifact/schema. Large per-frame PTS maps belong in checksummed working artifacts, not unbounded database JSON. Do not derive exact frame count from rounded duration.

A bounded versioned JSON payload is acceptable for heterogeneous stream inventories/probe evidence; query-critical identity, status and timing fields remain typed. Validate JSON on write. Inconclusive stream facts remain null/unknown with reasons, never synthetic values.

Preserve original upload storage identity when adding an artifact reference; backfill existing uploads safely, using existing reservation checksums or a verified checksum read. Do not move originals or rewrite 0001–0003. Create no new `policy_versions` table in 0E: reuse immutable versioned snapshots, as uploads already do.

Use foreign keys and unique composite keys to enforce same-project/asset/run/artifact references. Add indexes for project/asset/run lookups, segment temporal ordering, representative-frame lookup and stage cache lookup. Enforce positive denominators/dimensions where known, valid states, `0 <= start_frame < end_frame <= working_frame_count`, sample-in-segment bounds and confidence range. Cross-row bounds need transaction-level/application semantic validation as well as available database constraints. Parent intervals must contain children and parent links cannot cycle.

Make ordinary stage submission idempotent with a project/asset/stage/input/configuration key; do not forbid explicit new revisions with the same content. Publication uses a current lease and verified artifacts. Pending/failed partial results are never exposed as completed facts. Duration admission is serialized per project and counted once per asset, independent of re-analysis; compatibility rejection releases admitted capacity according to retention rules without pretending disk bytes have already disappeared.

### Later structures, not Phase 0E migrations

| Earliest phase | Planned logical structures | Scope |
|---|---|---|
| 0F | Transcript units/optional words, quote evidence, optional speaker labels | Timestamped Thai/English/mixed speech, sentence/semantic segmentation, context and timing |
| 0F before paid calls | Cost reservations and usage events | Atomic budget admission/reconciliation including uncertain requests; no paid gate in 0E |
| 0G | Visual observations | Frame/interval evidence, observed entities/actions/text/changes, uncertainty and coverage |
| 0H | Semantic role assignments | Versioned controlled taxonomy, multi-label confidence and evidence; taxonomy can be a versioned contract, not a database table |
| 0I | Quality assessments, take groups and members/rankings | Explainable component scores and non-destructive similarity proposals |
| 0J | Footage Library queries/indexes | Reuse existing evidence tables; no obligatory extra knowledge-base table or vector store |
| Phase 1 | Creative brief snapshots, storyboard sets/options/beats, EDL versions, renders | Contextual selection and immutable grounded story/render lineage |
| Phase 2 | Edit requests and caption/version extensions | Supported natural-language changes and subtitles |
| Deployment | Auth/ownership mapping, RLS and cloud-retention structures if needed | No Phase 0E auth, billing or production-only schema |

### Future semantic / editorial contracts

The controlled taxonomy is: HOOK, PROBLEM, CONTEXT, EXPERT_AUTHORITY, SOLUTION, DEMO, B_ROLL, PROOF, TESTIMONIAL, OBJECTION_HANDLER, OFFER, CTA, PAYOFF, TRANSITION, DISCLAIMER, LOW_VALUE.

A semantic assignment identifies project, asset, immutable segment/analysis revision, role, optional subtype, independent confidence in [0,1], evidence IDs and source intervals, rationale, limitations, taxonomy/schema/model/prompt versions and assessment status. Multiple roles may coexist; confidences do not sum to one. Insufficient evidence permits abstention; LOW_VALUE needs an explicit usability/editorial reason. Example: `{HOOK: 0.93, PROBLEM: 0.86, EXPERT_AUTHORITY: 0.52}` represents three assignments, not a mutually exclusive classification.

HOOK subtypes: question, problem, contrarian, result, price, curiosity, authority, transformation, fear_loss, social_proof, visual. CTA subtypes: hard_cta, soft_cta, offer_cta, urgency_cta, informational_cta, lead_cta. Validate subtypes under their parent role and taxonomy version; unknown extensions require explicit version handling, not arbitrary silent labels.

Quality components: visual quality, sharpness, stability, composition, face visibility, audio quality, delivery quality, emotional impact, story relevance, hook strength, CTA strength, conversion potential, editorial usefulness. Store nullable 0–100 score, applicability, rationale, evidence, measurement/rubric version and uncertainty per component. Confidence and quality score are different quantities. Optional aggregates record weights and missing-component handling; no universal score determines truth or automatically discards footage.

Future take groups identify member intervals, evidence of similarity and per-member rank/rationale based on transcript similarity, delivery, visual/audio quality, completeness and editorial usefulness. Preserve all member references and allow rejection/override. No embeddings/vector fields or destructive deduplication.

Phase 1 brief snapshots contain objective (Meta Lead Ad, Conversion / Sales, Awareness, Educational, Organic Social, Testimonial, Personal Brand, extensible), audience, message, desired action, duration and constraints. Contextual relevance/rankings reference the brief hash plus source-evidence snapshot. Keep them separate from reusable base observations/roles. Do not rerun source analysis for a new brief. Three complete options belong to a storyboard set; selected beats cite real intervals, semantic/quality evidence and rationale. EDL/render/edit contracts below remain unchanged except richer provenance.

Provider-reported confidence is nullable; do not invent it when absent. A model-estimated semantic confidence is separately labeled as an estimate with method/version, never presented as provider probability or measured certainty.

Originals, working media, temporary files, and final exports have separate accounting. Durable stage results identify immutable artifacts and must not depend on disposable temp paths. Storage migration verifies content hashes and changes location metadata without altering source timing/content identity or historical EDLs.

### Reservation integrity

- Reserve file slots/bytes transactionally against accepted usage plus live reservations; enforce a project-scoped unique intake idempotency key.
- Existing 0D reservation states are `reserved`, `uploading`, `uploaded`, `rejected`, `expired`; do not retroactively claim `accepted` or `cancelled` exists. Transfer completion is not technical acceptance. Record technical acceptance/rejection on media analysis/asset state; add a cancellation state only when its workflow is implemented.
- Record configurable expiry/renewal; retries reuse the same reservation/object. Finalization verifies checksum/size and accounts bytes exactly once. Post-probe duration admission is atomic before expensive analysis.
- Rejection, cancellation, or expiry releases capacity once and queues incomplete/rejected media cleanup. Keep pending-deletion disk usage visible until actual removal.
- Cost admission is atomic against spent plus outstanding/uncertain reservations. Resume/retry checks the current operator ceiling; historical job policy snapshots remain unchanged. Unknown cost cannot silently bypass the guardrail.

## 3. Relationships and integrity

- Project → many assets.
- Asset → many analysis revisions; current successful revision per stage, rather than a single global revision that would invalidate unrelated layers.
- Technical analysis revision → metadata, artifacts, temporal segments and representative frames; later stage revisions link to those immutable inputs and add transcripts, observations, semantic roles, scores and take groups.
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
| Provenance | Creative brief and selected storyboard, frozen evidence/analysis revisions, source selection rationale, creation reason |
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

A `partial` asset remains inspectable. Technical-stage completion in 0E is not full editorial readiness; expose stage status separately from aggregate asset status. Story eligibility is evaluated in Phase 1 against its frozen evidence snapshot and brief, not inferred merely from a completed probe.

Mandatory story eligibility means a verified working artifact and timing map, temporal intervals, representative frames and evidence-linked visual/semantic assessments for selected intervals. Roles may be uncertain or absent; the Director must explain insufficient support instead of forcing a label. Unsampled intervals are not understood by default. No-audio/no-speech is valid; missing speech transcription requires recorded user exclusion from speech use. Quality components may be null; optional aggregates disclose normalization. Brief-specific confidence thresholds and selection rubrics are evaluated in Phase 1. Readiness is separate from job pause/cancellation state.

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
