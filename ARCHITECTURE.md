# ARCHITECTURE.md

**Status:** Phase 0A–0D completed; version 0.3 planning revision only; Phase 0E not started

**Version:** 0.3

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
| OpenAI API (Phase 0F onward, evaluated per stage) | Transcription, selective visual/semantic interpretation, story and edit proposals; no Phase 0E prerequisite |
| Remotion | Deferred beyond Phase 1; no Phase 0/1 dependency |

Heavy work must never depend on a browser session or run inside a short-lived web request.

The existing TypeScript worker will grow into one modular local process with durable stage handlers; no Docker requirement. Independent deployment/scaling can follow later.

Phase 0 supports explicit local single-user development without login. Bind local services to loopback and enforce local-origin/project checks; the no-login mode must not be enabled for multi-user production. Keep owner fields without requiring an authentication-provider record. Authentication and RLS hardening are deployment gates, not Phase 0 prerequisites.

Use a PostgreSQL polling/claiming worker. Redis and BullMQ are excluded throughout the MVP. Embeddings and vector search are also excluded throughout the MVP. The repository already implements Phase 0A–0D. This version 0.3 revision changes planning only and does not authorize Phase 0E implementation or dependency installation.

## 2. Upload and analysis pipeline

**Product direction: AI Creative Director + AI Video Editor.**

Uploaded Media → Technical Media Intelligence → Temporal Segmentation → Transcript Intelligence → Visual Intelligence → Semantic Video Intelligence → Quality / Best-Take Intelligence → Footage Knowledge Base → Creative Director → Storyboard → EDL → Render.

This is a logical dependency pipeline, not one monolithic job. Persist each stage independently; compatible independent stages may reuse their own inputs without recomputing predecessors. No downstream stage may silently promote incomplete evidence to certainty.

| Stage / gate | Inputs and published results |
|---|---|
| Uploaded Media (0D complete) | Local project-scoped resumable uploads, immutable originals, checksum and quota reservations; metadata fields remain nullable pending probe |
| Technical Media Intelligence (0E) | ffprobe stream/container evidence → canonical metadata (duration, dimensions, rational frame rate, codec, audio streams, orientation, CFR/VFR/unknown), compatibility decision, verified normalized working artifact and original-to-working timing map |
| Temporal Segmentation (0E foundation) | Deterministic FFmpeg shot-change candidates, continuous-shot fallback, bounded editorial intervals and representative frames with exact timeline references; semantic scene grouping is later |
| Transcript Intelligence (0F) | Synchronized analysis audio → timestamped Thai/English/mixed speech, sentence/semantic units, contextual quote candidates, optional technically justified speaker labels; preserve no-audio/no-speech |
| Visual Intelligence (0G) | Selected frames/intervals → people, objects, setting, action, shot type, composition, visible text, before/after imagery, demonstrations and observed temporal changes |
| Semantic Video Intelligence (0H) | Transcript + visual + temporal evidence → independent multi-role confidence, rationale, limitations and versioned taxonomy from PRD/DATA_MODEL |
| Quality / Best-Take Intelligence (0I) | Technical metrics plus source evidence → explainable score components and candidate similar-take groups/rankings |
| Footage Knowledge Base / Footage Library (0J) | Queryable persisted stage results and coverage, source playback, roles/quotes/quality/take filters, metadata/tag/transcript/keyword retrieval |
| Creative Director (Phase 1) | Brief + frozen evidence snapshot → three objective-conditioned concepts, grounded storyboards and shot selection, then validated immutable EDL and FFmpeg render |

The completed local upload protocol uses persisted reservations and bounded chunks; it does not require choosing a new transfer library. Cloud resumable transport is a future adapter decision. Supabase Free storage limits must not block local development.

### Phase 0E boundary and technical outputs

No OpenAI account, key, SDK, model call or cost reservation table is required in Phase 0E. Use configurable `FFPROBE_PATH` and `FFMPEG_PATH`, with PATH fallback and actionable configuration errors. Invoke allowlisted subprocess arguments without shell interpolation, apply resource limits/timeouts and terminate process trees safely.

Probe accepted originals, including M4V, before expensive processing. Store selected video/audio stream indexes and all stream inventory, coded and display dimensions, sample/display aspect ratio, rotation, duration derivation, rational average/nominal frame rate, codec/profile and audio channels/sample rate. CFR/VFR detection records method and evidence; disagreement between nominal and average rates is not proof of VFR. Bounded packet/frame inspection may refine classification; report unknown if inconclusive.

Establish verified normalization and its timing map in 0E so subsequent layers share the canonical timeline. Probe metadata, normalization, temporal segmentation and representative-frame extraction are separately cacheable technical stages. No speech extraction/transcription, visual model calls, semantic roles, editorial scores, best-take detection or creative generation in 0E. Representative images are extraction artifacts, not visual understanding.

Use the existing PostgreSQL job shell for technical-stage execution with leases, bounded retries, pause/cancel checkpoints, concurrency controls, temporary cleanup and idempotent publication. Implement only the job persistence additions required for those handlers; do not build a general workflow platform. Full library/search UX arrives in 0J; 0E needs only inspection/status sufficient to verify its artifacts.

### Editorial evidence contract

PRD defines the controlled role taxonomy and optional HOOK/CTA subtypes. Persist multiple independent role assignments per segment, each with 0–1 confidence, rationale, evidence IDs/ranges, provenance and unknown/insufficient-evidence status. These are estimates, not objective labels. Separate observation from inference, especially claimed authority, results, testimonials and before/after causality. Do not force a role or infer low value from absent analysis.

Quality components follow PRD: visual quality, sharpness, stability, composition, face visibility, audio quality, delivery quality, emotional impact, story relevance, hook strength, CTA strength, conversion potential and editorial usefulness. Store method/rubric, evidence, uncertainty and applicability; missing scores stay null. Aggregates are optional and explain their weights. Contextual scores include a brief hash; conversion estimates are not business-outcome predictions.

In 0I, propose repeated-take groups using lexical transcript similarity plus delivery, visual/audio quality, completeness and editorial usefulness. No embeddings. Preserve all takes, explain ranking and allow override; near-duplicate wording with a changed qualification may express a different claim. Best-take detection is not part of 0E.

The Footage Knowledge Base is a logical view over versioned PostgreSQL evidence and immutable artifacts, not a new vector database or separate service. Source analysis stays reusable across briefs. Phase 1 contextual assessment consumes the same evidence without reprobe, retranscription or vision reruns.

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

Original probe facts retain original stream coordinates. Published downstream analysis timestamps and EDL source ranges use the verified working-video timebase; preliminary original-timeline candidates must name their coordinate system and cannot be consumed as normalized ranges. Store original stream timebases/start PTS, normalization profile/version, working frame count, and a per-frame original-video PTS mapping, including dropped/duplicated VFR frames. Do not claim an exact inverse for discarded original frames. Frame n has working time n/30 seconds; millisecond labels are display values, not a second timing source of truth.

Preserve audio/video offsets during normalization. Do not independently reset audio and video in a way that changes synchronization.

Set working time zero to the first retained displayed video frame. Map audio onto that common origin: discard audio preceding it, insert leading silence for delayed audio, and pad/trim to the normalized video duration. Working audio, when present, is AAC 48 kHz stereo; use PCM 48 kHz stereo for decoded render intermediates. Keep no-audio/no-speech metadata distinct from inserted silence. Analysis audio defaults to mono 16 kHz PCM, compressed or chunked for provider upload, with chunk origin, overlap, codec delay, and effective timestamp offsets recorded. Final MP4 uses H.264/yuv420p at 30 fps and AAC 48 kHz stereo. Encoder delay must be accounted for in verification.

This intentionally prioritizes reproducible 1080p-class MVP exports over original-resolution mastering.

### Scene and frame policy

Configurable starting policy, tuned during Phase 0 and saved with each analysis revision:

- Detect visual shot changes deterministically in 0E; boundaries are candidates, not semantic scene understanding.
- Treat a continuous recording as a valid single shot, without inventing semantic scene boundaries.
- Split long shots into useful editorial intervals, default maximum ten seconds; later transcript/semantic units can overlap these intervals without rewriting original segment revisions.
- Extract a midpoint frame per segment and extra boundary frames where useful.
- Default vision input cap: 300 frames per project, allocated deterministically across eligible assets/segments. Record unsampled intervals and coverage; do not fabricate observations for them.
- If the cap reduces sampling density, record and display that limitation.

Scene boundaries are candidates, not guaranteed edit points. Transcript boundaries help avoid cuts in the middle of sentences.

### Transcription policy

Use an OpenAI transcription configuration that actually provides the required timestamp granularity. Do not assume every transcription model has interchangeable output fields.

Select and verify the Phase 0F provider/model and its current upload/timestamp capabilities before implementation of that stage. Do not assume timestamp granularity, language support or speaker labels are interchangeable across models. Evaluate Thai, English and mixed-language fixtures; reconcile chunk offsets, overlap and codec delay before publishing. Keep the provider adapter replaceable.

Useful quotes retain surrounding context and exact evidence intervals. Sentence/semantic units must not discard negations or qualifications. Speaker information is optional and records the method/confidence; lack of reliable diarization does not justify invented identities. No transcription dependency is installed for Phase 0E.

No-audio and no-speech results are valid outcomes, not processing failures.

### Search policy

Start with:

- Indexed English transcript/description search.
- Thai substring and trigram-assisted matching.
- Phase 0J filters for asset, speech presence/language, role/subtype, confidence/coverage, quality warnings, take group and tags; unknown values remain distinguishable.

Include metadata, tags, transcript, and description keywords. No embeddings, vector columns/indexes, or vector service in the MVP. Full-text search alone must not be assumed sufficient for Thai; tune the keyword baseline against the labeled retrieval benchmark.

### Analysis caching and invalidation

Persist stage cache keys from project scope, immutable input content/artifact hashes, relevant normalization/sampling parameters, and pipeline/model/prompt/schema versions. Reuse only completed, checksum-verified results with matching keys. Retry only incomplete or invalidated stages; changed sampling must not automatically retranscribe unchanged audio. Reopening, search, new briefs, EDL edits, ratio/caption changes, and render retries do not trigger footage re-analysis. Explicit force-reruns record the reason and require the same spending checks, producing a new revision. Ordinary duplicate submissions coalesce through idempotency; do not share private analysis across projects implicitly.

## 3. Story and EDL pipeline

**Phase 1:** Creative Brief → Creative Director → Three Story Concepts → Shot Selection → Validated EDL → FFmpeg Render.

1. Capture a versioned creative brief: objective, audience, message, desired action, constraints and duration; Phase 1 uses 9:16 only. Objective presets include Meta Lead Ad, Conversion / Sales, Awareness, Educational, Organic Social, Testimonial and Personal Brand; allow extension without one universal story formula.
2. Freeze a snapshot of eligible analysis revisions.
3. Retrieve evidence-backed segments, semantic roles, quotes, take alternatives and quality limitations; compute brief-conditioned relevance from cached facts.
4. The Creative Director proposes three structured concepts with distinct rationale/structure suited to the brief, each represented by grounded storyboard beats. Preserve necessary disclaimers and context.
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
| Semantic role/quality score mistaken for fact | Misleading selection or unsupported claims | Evidence, uncertainty, null/abstain, rubric evaluation and user override |
| Similar takes differ in meaning | Lost qualification or wrong claim | Context/completeness review and retained alternatives |
| Universal story template | Poor fit for objective/audience | Versioned creative brief and comparative objective fixtures |
| Model refusal or malformed response | Blocked workflow | Typed failure, bounded retry, retained prior state |

Vision descriptions must remain inspectable and uncertain where appropriate; OpenAI explicitly documents visual interpretation limitations. [Source: OpenAI images and vision](https://developers.openai.com/api/docs/guides/images-vision)

## 10. Repository structure and implementation boundary

The five planning documents and completed Phase 0A–0D code remain in the existing npm-workspaces repository.

| Path | Current role / later extension |
|---|---|
| `apps/web/` | Existing projects/upload UI and thin server endpoints; later intelligence inspection |
| `apps/worker/` | Existing TypeScript shell; technical job execution begins in 0E |
| `packages/contracts/` | Shared versioned schemas; add each intelligence contract when its stage is implemented |
| `packages/media/` | Existing local upload/storage adapter; future probing, timing, normalization and render planning |
| `packages/db/` | Existing typed PostgreSQL access and integration tests |
| `packages/db/migrations/` | Existing 0001–0003 migrations; additive migrations only, never rewrite applied history |
| `tests/` | Existing workflow/upload tests; add stage-specific unit/integration/evaluation fixtures as needed |
| `references/` | Intentionally tracked reference-video.mp4; design reference, separate from evaluation fixtures |
| Optional future modules | AI adapters from 0F onward; split storage into a separate package only if needed; no Supabase/Docker dependency now |

Runtime originals/working/temp/exports remain under configured MEDIA_ROOT, preferably outside the repository, and ignored by Git. No new packages, migrations or application changes are made by this planning revision.

## 11. Remaining decisions and explicit exclusions

- Resolved by 0A–0D: TypeScript/npm workspaces, local PostgreSQL, local owner and bounded resumable uploads. Before 0E: record installed ffprobe/FFmpeg versions, exact normalization/segmentation profiles, VFR classification method, timestamp-map encoding, resource limits and technical fixture manifest.
- Before paid benchmarks: transcription/vision/semantic/story models and prompt versions, hardware, numeric spending settings, fixture inventory/rights, mixed-language scoring/threshold and text-normalization rules. Before 0H/0I: freeze role/abstention, score applicability, take-equivalence and ranking rubrics/thresholds on held-out evidence. Before Phase 1: validate objective-specific selection thresholds and brief schema. Resource timeouts/retries/disk/cleanup are already a 0E gate.
- Before multi-user production: hosting, authenticated login method, RLS policies, cloud storage plan, backup/provider retention, and issued-URL expiry/revocation policy.
- Beyond MVP: embeddings/vector search, HEVC/HDR expansion, music/voiceover/overlapping tracks, collaboration, billing, desktop packaging, and automatic subject tracking. GPU processing is optional future work.
- Beyond Phase 1 only, if separately justified: Remotion. FFmpeg remains sufficient for the planned MVP.
- Quotas may change through validated configuration; larger workloads require capacity evaluation, not an architectural rewrite.

Canonical timing, project boundaries, EDL validation/versioning, analysis caching and retry-safe recovery remain mandatory at their phase gates. Authentication is deferred until multi-user deployment. Phase 0A–0D are complete; this is a planning-only revision and Phase 0E has not begun.
