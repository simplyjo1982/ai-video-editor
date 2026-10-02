# MVP_ROADMAP.md

**Status:** Phase 0A–0D completed; version 0.3 planning revision only; Phase 0E not started

**Version:** 0.3

## Delivery approach

Use evidence-based phase gates. A phase is complete when its workflow passes with real media, not when its screens are finished.

Version 0.3 plans the AI Creative Director + AI Video Editor direction. Phase 0A–0D are completed: npm-workspaces foundation, PostgreSQL, projects and resumable local uploads. This update changes planning documents only. Do not implement Phase 0E, install dependencies or create migrations until separately instructed.

Across the MVP: PostgreSQL-backed jobs with a polling/claiming worker; no Redis/BullMQ and no embeddings/vector search. FFmpeg is the only required Phase 0/1 engine; Remotion is deferred beyond Phase 1. PRD quotas are configurable defaults. Preserve canonical timestamps, validated immutable EDLs, retry-safe jobs, analysis caching, and prevention of unnecessary re-analysis. Use lowercase `references/`.

## Phase 0 — Prove footage understanding

**Required proof:**

Uploaded Media → Technical Media Intelligence → Temporal Segmentation → Transcript Intelligence → Visual Intelligence → Semantic Video Intelligence → Quality / Best-Take Intelligence → Footage Knowledge Base. Phase 1 continues with Creative Director → Storyboard → EDL → Render.

Each stage publishes reusable evidence, not merely a transcript or description. Unknown/unsampled evidence stays explicit.

### Delivery stages and boundaries

| Stage | Scope and exit evidence |
|---|---|
| Phase 0A — Foundation (complete) | TypeScript/npm workspaces, Next.js web, worker shell, shared packages |
| Phase 0B — Database foundation (complete) | Local PostgreSQL, typed access, initial migrations and connectivity tests |
| Phase 0C — Projects (complete) | Create/list/open persisted projects under local owner, no login |
| Phase 0D — Resumable local uploads (complete) | Original storage, quota reservations, multiple files, persistence and recovery; no processing |
| Phase 0E — Technical Media Intelligence | ffprobe, canonical technical metadata, verified normalization/timestamp mapping, temporal segmentation and representative-frame foundations; no OpenAI |
| Phase 0F — Transcript Intelligence | Synchronized analysis audio, Thai/English/mixed timestamped speech, sentence/semantic units, useful quotes; optional justified speaker labels |
| Phase 0G — Visual Intelligence | Selective frame/interval evidence for people, objects, setting, action, shot type, composition, visible text, before/after, demonstrations and temporal changes |
| Phase 0H — Semantic Video Intelligence | Controlled role taxonomy, independent multi-role confidence, evidence/rationale, abstention and optional subtype support |
| Phase 0I — Quality + Best Take Intelligence | Explainable component scores, candidate similar/duplicate take groups, ranked alternatives and override |
| Phase 0J — Footage Library | Integrated Footage Knowledge Base inspection, source playback, role/quote/quality/take filters and metadata/tag/transcript/keyword retrieval |

### Phase 0E — Technical Media Intelligence

This is the next implementation boundary, not an authorization to implement it in this revision.

- Integrate ffprobe/FFmpeg using configurable FFMPEG_PATH/FFPROBE_PATH with PATH fallback; safe arguments, bounded subprocesses and disk/concurrency limits.
- Persist duration, dimensions, rational frame rate, codec, audio streams, orientation, CFR/VFR/unknown evidence, stream timebases/start PTS and normalization information. Validate compatibility and atomically admit actual duration against configurable quotas.
- Produce verified canonical working media and an original-to-working timing map. Preserve A/V origin, delayed audio, rotation and VFR duplicate/drop mapping. Do not fake metadata.
- Establish deterministic candidate shot detection, continuous-shot fallback, bounded editorial intervals and representative-frame extraction with frame/PTS provenance and coverage. Semantic scene grouping is later.
- Reuse PostgreSQL jobs and analysis_runs for separate cacheable technical stages, lease-safe publication, retries, pause/resume, cancellation and cleanup. Persist only DATA_MODEL.md's justified additions: artifacts, media_metadata, temporal_segments, representative_frames, and needed extensions of existing rows.
- Preserve uploads and applied migrations. Show technical status/results sufficient for inspection without requiring the full 0J library.
- Pass 0E with no OpenAI key, SDK or external AI calls. No transcription, AI descriptions, semantic roles, editorial/quality ranking, best-take detection, story generation, EDL or rendering.

### Phase 0F — Transcript Intelligence

Extract synchronized analysis audio and use an evaluated timestamp-capable provider for Thai, English and mixed speech. Preserve chunk offsets/overlap, no-audio/no-speech outcomes, sentence/semantic units and useful quotes with context. Add speaker labels only if technically justified; never guess identities. Establish atomic API spending guardrails before any paid request. Select models and benchmark thresholds at this gate, not in 0E.

### Phase 0G — Visual Intelligence

Use deterministic segmentation and capped representative samples before selective multimodal calls. Describe supported people/objects/settings/actions, shot type/composition, visible text, before/after imagery, demonstrations and temporal changes. Cite evidence and report uncertainty/unsampled intervals. Do not send every frame or claim a sampled still proves continuous action or causation.

### Phase 0H — Semantic Video Intelligence

Implement PRD/DATA_MODEL's versioned taxonomy: HOOK, PROBLEM, CONTEXT, EXPERT_AUTHORITY, SOLUTION, DEMO, B_ROLL, PROOF, TESTIMONIAL, OBJECTION_HANDLER, OFFER, CTA, PAYOFF, TRANSITION, DISCLAIMER, LOW_VALUE. A segment can have several roles with independent confidence. Preserve rationale and frame/transcript evidence; abstain when insufficient. Plan optional HOOK/CTA subtypes as specified in PRD; no single forced role or automatic deletion of low-value material.

### Phase 0I — Quality + Best Take Intelligence

Score visual quality, sharpness, stability, composition, face visibility, audio quality, delivery quality, emotional impact, story relevance, hook strength, CTA strength, conversion potential and editorial usefulness. Separate technical measurements from subjective estimates; record rubric, evidence, uncertainty and null/inapplicable values. Contextual scores require explicit assessment context; Phase 1 binds them to briefs. No universal fixed-weight score or promised conversion result.

Propose repeated-take groups using lexical transcript similarity, delivery, visual/audio quality, completeness and editorial usefulness. Preserve meaning, negations and qualifications, retain every take, and offer rank rationale/override. No embeddings or vector search. Neither detection nor editorial scoring belongs in 0E.

### Phase 0J — Footage Library

Integrate evidence stores into an inspectable Footage Knowledge Base with coverage, stage status, role/quality/quote/take views and source playback. Retrieve via metadata, tags, transcript and keywords, including Thai/English/mixed-language evaluation. Do not introduce a separate knowledge-base service or vector store.

### Cross-stage deliverables

- Local owner without login; local PostgreSQL and storage abstraction, no hosted Supabase or paid storage requirement.
- Atomic resumable slot/byte reservations; post-probe duration admission; separate originals/working/temp/exports budgets and retention.
- Immutable artifacts/revisions, stage dependencies/cache keys, current-lease publication, bounded retry/timeouts/concurrency, pause/resume/cancellation and cleanup.
- Configurable sampling caps/coverage and cost reservations before paid stages from 0F onward.
- Licensed/synthetic fixtures, labeled evidence and versioned rubrics; distinguish completed 0A–0D checks from new planned gates.

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
- All Phase 0 tests P0-01–P0-43 and assigned system gates pass by 0J, incrementally according to ACCEPTANCE_TESTS.md. Technical-only 0E passes independently of paid AI gates. Authentication/RLS remains a deployment gate.

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

Creative Brief → Creative Director → Three Story Concepts → Shot Selection → Validated EDL → FFmpeg Render. Each concept is presented as a grounded storyboard before selection.

### Deliverables

- Versioned brief: objective, audience, message, desired action, constraints and duration; fixed initial 9:16 output. Support Meta Lead Ad, Conversion / Sales, Awareness, Educational, Organic Social, Testimonial and Personal Brand, with extensible objectives.
- Creative Director generates three concepts/storyboards from a frozen evidence snapshot, semantic roles and take alternatives; rationale and structure depend on the brief, never one universal formula.
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
- Phase 1 tests P1-01–P1-23 and their system gates pass, including objective-dependent selection, portrait output and safe fit.

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

Resolve ARCHITECTURE.md decisions at their gates: technical profiles, timestamp-map encoding, detector/sampling parameters and resource limits before 0E implementation; models, mixed-language thresholds, semantic/quality/take rubrics and held-out evaluation before their AI stages; authentication/hosting and cloud retention before multi-user production. Local provisioning, TypeScript/npm and resumable uploads are established. These decisions do not reopen the approved local mode, portrait-first export, FFmpeg, PostgreSQL queue, or no-vector-search scope.
