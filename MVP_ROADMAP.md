# MVP_ROADMAP.md

**Status:** Planning revised to approved MVP decisions; implementation not started  
**Version:** 0.2

## Delivery approach

Use evidence-based phase gates. A phase is complete when its workflow passes with real media, not when its screens are finished.

This revision records the approved MVP decisions and pre-implementation clarifications only. Do not start implementation, install dependencies, or initialize Next.js as part of this document update. Implementation requires a subsequent instruction.

Across the MVP: PostgreSQL-backed jobs with a polling/claiming worker; no Redis/BullMQ and no embeddings/vector search. FFmpeg is the only required Phase 0/1 engine; Remotion is deferred beyond Phase 1. PRD quotas are configurable defaults. Preserve canonical timestamps, validated immutable EDLs, retry-safe jobs, analysis caching, and prevention of unnecessary re-analysis. Use lowercase `references/`.

## Phase 0 — Prove footage understanding

**Required proof:**

Upload videos → analyze videos → extract transcript and frames → show footage analysis in the UI.

### Deliverables

- Local single-user projects without login; owner fields retained. Authentication and production RLS do not block Phase 0.
- Local PostgreSQL support and local storage abstraction compatible with future Supabase/cloud storage; no paid Supabase storage prerequisite.
- Multiple resumable uploads with atomic slot/byte reservations, expiry/release, idempotent finalization, and actual duration admission after probing.
- Media validation and metadata.
- Separate PostgreSQL polling/claiming worker with leases, heartbeats, bounded retries, and idempotent publication.
- Working-media normalization and preview proxies.
- Scene detection and segment creation.
- Audio and representative-frame extraction.
- Timestamped Thai/English transcription.
- Visual summaries and source references.
- Metadata/tag/transcript/keyword search and explainable quality scores; no embeddings.
- Progress, retry, partial-failure handling, pause/resume, budget/dependency pauses, and cancellation states.
- Configurable project limits and frame sampling; API spending reservations/guardrails, subprocess timeouts, and concurrency limits.
- Distinct original, working, temporary, and final-export storage classes; safe temporary cleanup and retention rules for version dependencies.
- Stage-level analysis caching with explicit invalidation, preventing paid re-analysis on reopening or downstream edits.
- Licensed/synthetic fixture manifest, human labels, evaluation rules, and recorded configuration/version evidence.

### Exit criteria

- Five mixed-orientation videos can be uploaded in one session.
- Analysis remains available after refresh or browser closure.
- Every displayed frame and transcript segment links to playable source time.
- Silent footage produces no fabricated transcript.
- Thai and English search retrieve relevant source segments.
- A worker restart resumes unfinished work without duplicating published analysis.
- Reopening/retrying completed work reuses valid analysis; changed settings invalidate only dependent stages.
- The workflow succeeds locally without login or hosted Supabase credentials/storage.
- Configured budgets, retries, timeouts, concurrency, upload reservations, pause/resume/cancellation, and cleanup pass their tests.
- Phase 0 tests P0-01–P0-34 and Phase 0 system gates in ACCEPTANCE_TESTS.md pass. Multi-user authentication/RLS gates are deferred until deployment readiness.

### Performance experiment

Benchmark on a recorded worker configuration:

- Five H.264 SDR videos.
- Ten minutes total.
- Up to 1080p.
- One active analysis project.

Proposed target: complete analysis within 15 minutes after upload completion.

This is a target to validate, not a promised service level. Record elapsed time, provider usage, peak memory, and temporary disk consumption.

Run separate capability/boundary fixtures at configured limits, including the default 20 files, 30 minutes, 1 GB/file, 5 GB/project, and accepted 4K/60 fps media. The smaller timing benchmark does not prove full-limit capacity. Run a second reduced-limit configuration to prove quotas and sampling are not hard-coded. Numeric spending ceilings, timeout/retry budgets, and benchmark hardware must be recorded before paid evaluation.

## Phase 1 — Prove story-to-video

**Required proof:**

Analyzed footage → three stories → story selection → EDL → actual MP4.

### Deliverables

- Brief inputs; fixed initial 9:16 output profile.
- Three grounded storyboards.
- Story selection.
- Ordered clip review with remove/reorder/replace/in-out adjustments, each saved as a validated new EDL version.
- EDL v1 and deterministic validation.
- FFmpeg rendering.
- Verified MP4 preview and download.
- Saved EDL/render versions.
- Initial 1080 × 1920 (9:16) at 30 fps with safe fit/centered padding preserving complete source proportions. Crop controls, subtitles, 1:1, and 16:9 arrive in Phase 2.
- Existing Phase 0 analysis reused for story generation, clip edits, and render retry.

### Exit criteria

- Three materially distinct options on sufficient footage.
- All selected source IDs and ranges validate.
- A selected story renders without manual developer intervention.
- Render contains the expected source clips in the expected order.
- Preview and download refer to the same verified artifact.
- Invalid EDLs never reach FFmpeg.
- Phase 1 tests P1-01–P1-21 and their system gates pass, including portrait output and safe fit.

Proposed performance target: a 60-second 1080 × 1920 (9:16) render completes within five minutes on the benchmark worker, excluding queue time.

## Phase 2 — Complete the requested MVP

### Deliverables

- Natural-language editing with previewed changes.
- Restore UX over the immutable versions already established in Phase 1.
- Subtitle generation, correction, burn-in, and SRT.
- Add 1:1 (1080 × 1080) and 16:9 (1920 × 1080) exports alongside 9:16.
- Preserve safe fit; add explicit saved crop controls with bounded normalized coordinates.
- Conflict handling for stale edits.

### Exit criteria

- Supported instructions produce the intended new EDL.
- A changed EDL produces a new playable MP4.
- Earlier versions remain available.
- Thai and English subtitles render correctly.
- All three aspect ratios have exact requested dimensions.
- Ambiguous instructions leave the current edit unchanged pending clarification.

## Phase 3 — Pilot readiness

### Deliverables

- Harden Phase 0 cost ceilings and expand usage reporting.
- Complete project deletion UX and cloud/backup/provider retention policy; temporary cleanup already required in Phase 0.
- Authentication and RLS hardening plus cross-user isolation before any multi-user production deployment. Local-only development remains available.
- Cancellation and recovery hardening over Phase 0 controls.
- Performance measurements.
- Five-user usability pilot.
- Operating documentation.

### Exit criteria

- All applicable release tests pass. Any multi-user production pilot must also pass authenticated ownership/RLS/cloud isolation gates; these do not retroactively block local Phase 0.
- No unresolved defect involving cross-user access, lost edits, false render completion, or systematically invalid timing.
- At least four of five pilot users complete the primary workflow.
- Measured operating costs and remaining limitations are documented.

## Complexity to avoid

| Avoid now | Use instead |
|---|---|
| Professional timeline | Ordered clip cards |
| Multiple render engines | FFmpeg only through Phase 1; Remotion deferred |
| Autonomous agent swarm | Explicit pipeline stages and schemas |
| Streaming analysis of every frame | Bounded representative sampling |
| Embeddings/vector search anywhere in MVP | Metadata, tags, transcript, and keyword retrieval |
| Redis or BullMQ anywhere in MVP | PostgreSQL job records and polling/claiming worker |
| Separate microservice for every stage | One modular worker application |
| Fine-tuned models | Prompt/version evaluation |
| Automatic narrative voiceover | Existing source audio |
| Hard-coded project quotas | Configurable defaults, initially 20 files, tested at boundaries |
| Authentication/cloud storage prerequisite | Local single-user mode and local storage abstraction |

## Remaining setup decisions

Resolve the ARCHITECTURE.md decision register at its stated gates: runtime/tool versions and local provisioning before setup; models, fixture inventory, hardware, and numeric operating budgets before paid benchmarks; authentication/hosting and cloud retention policies before multi-user production. These decisions do not reopen the approved local mode, portrait-first export, FFmpeg, PostgreSQL queue, or no-vector-search scope.
