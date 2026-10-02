# ACCEPTANCE_TESTS.md

**Status:** Phase 0A–0D checks completed in their implementation checkpoints; new version 0.3 gates are planned, not executed

**Version:** 0.3

## 1. Test principles

Version 0.3 evaluates an **AI Creative Director + AI Video Editor**. The target pipeline is Uploaded Media → Technical Media Intelligence → Temporal Segmentation → Transcript Intelligence → Visual Intelligence → Semantic Video Intelligence → Quality / Best-Take Intelligence → Footage Knowledge Base → Creative Director → Storyboard → EDL → Render. Phase 0A–0D are the completed baseline; the new gates below are planned requirements, not new test results.

- Critical workflow tests use real media and real FFmpeg output.
- Provider mocks test error handling, but cannot prove AI quality.
- Phase 0E must pass with no OpenAI account/key/SDK or API calls. Real provider evaluation starts in 0F and applies only to its later AI stage; mocks alone cannot prove language, visual, semantic or editorial quality.
- Tests assert behavior and artifacts, not just successful HTTP responses.
- Record software/model versions and worker configuration with results.
- Phase 0 is tested in local single-user mode without login, Auth-provider users, production RLS, or paid Supabase storage. Retained owner fields and same-project constraints still apply.
- Use local PostgreSQL job records and a polling/claiming worker. No Redis/BullMQ, embeddings, or vector search in MVP test prerequisites. FFmpeg is the only required Phase 0/1 engine; Remotion is deferred beyond Phase 1.
- Phase 1's required export is 1080 × 1920 (9:16), with safe fit/padding. Phase 2 adds 1:1 and 16:9.
- PRD limits and sampling are configurable defaults. Test both default and alternate configurations without source/schema changes.

## 2. Fixture pack

Prepare licensed or synthetic fixtures covering:

- Clear English speech.
- Clear Thai speech.
- Mixed Thai/English speech.
- Silent footage.
- Audio track with no speech.
- Continuous single-shot footage.
- Several hard scene cuts.
- Portrait, landscape, and square inputs.
- Rotation metadata.
- Variable frame rate.
- Delayed audio start and synchronization markers.
- Blurry/dark/shaky footage.
- Corrupt files.
- Unsupported codec/HDR input.
- Insufficient material for three credible stories.
- Two local projects for project-boundary checks; two authenticated users with separate private projects for the later multi-user deployment gate.

Include human-labeled transcripts, shot boundaries, relevant search results and expected render source order. Add multi-role segments (including overlapping HOOK/PROBLEM/EXPERT_AUTHORITY), qualifications/disclaimers, unknown/ambiguous evidence, demonstrations, useful B-roll without faces, observed before/after imagery, and repeated takes with changed negations or incomplete sentences. Label role evidence, quality applicability, take equivalence/completeness and different selections for different creative objectives.

### Fixture manifest and evaluation protocol

- Keep test fixtures separate from `references/`. The current `references/reference-video.mp4` is a promotional design reference, not proof of media correctness or AI quality. Record origin, rights, checksum, and timecoded reference notes before redistribution; its prior visual observations were not independently replayed in the assessment.
- Each fixture manifest records license/consent, checksum, duration, codec/profile, orientation, frame-rate/timebase, audio offsets, labels, and expected artifacts. Large fixtures may be generated deterministically later; record recipe/tool versions and checksums instead of committing large binaries blindly.
- Freeze evaluation fixtures before tuning final acceptance thresholds. Include separate tuning and held-out sets. Minimum clean evaluation: five distinct recordings and five minutes of speech each for English, Thai, and mixed Thai/English; report per-recording and aggregate results.
- Normalize labels/predictions consistently: Unicode NFC, declared punctuation/whitespace rules, and English case folding. Do not remove Thai combining marks or silently normalize away meaningful errors. Version the normalization rules. English WER and Thai CER retain the thresholds below; mixed-language scoring/threshold must be fixed and documented before paid benchmark evaluation, and reported separately from monolingual/noisy results.
- Label at least 40 hard cuts, 40 speech boundaries per language category, and 50 factual visual observations across assets. Review narrative distinctness/grounding with two reviewers using a written rubric; resolve disagreements and report sample counts. Assess preserved meaning as well as valid timestamps.
- Search baseline: 20 labeled queries, split equally between Thai and English, covering metadata, tags, transcript, and description keywords; report each language separately and combined. Add mixed-language queries as a separately reported set.
- Include all configured-limit boundaries and concurrency races, plus full-limit media capability fixtures separate from the five-file performance benchmark. Smaller test quotas alone do not validate 4K/60 fps or the default 30-minute capacity.
- Before 0H/0I acceptance, freeze multi-label role, confidence/abstention, quote-context, subjective-score and take-grouping rubrics with two reviewers and adjudication. Report per-role precision/recall, multi-label errors, confidence calibration (only if claimed), abstention/coverage, take false merges and rank agreement. Set numeric AI-quality thresholds before tuning on held-out evidence; no unvalidated confidence cutoff or invented performance claim. Record limitations and disagreements.
- Record cold versus cached runs, effective policy, API call counts/cost reservations, hardware, peak memory/disk, model/prompt/FFmpeg versions, and fixture IDs. Acceptance tests remain planned until evidence is captured.

## 3. Phase 0 acceptance tests

| ID | Scenario | Pass condition |
|---|---|---|
| P0-01 | Upload five videos | Five distinct assets reach completed upload state |
| P0-02 | Interrupt upload | Transfer resumes without creating a duplicate asset |
| P0-03 | Exceed limits | Clear rejection; expensive analysis does not start |
| P0-04 | Probe media | Duration within 100 ms of fixture ground truth; dimensions, rational rates, codecs, audio streams and orientation correct; CFR/VFR/unknown includes method/evidence and original timebases/start PTS |
| P0-05 | Normalize VFR/rotation | Correct orientation; constant 30 fps; no accumulated A/V drift over 100 ms |
| P0-06 | Detect known hard cuts | Precision and recall each ≥90% on labeled hard-cut fixtures, within 250 ms |
| P0-07 | Continuous shot | Valid analysis without requiring an artificial shot boundary |
| P0-08 | Extract frames | Every frame has a valid artifact and timestamp within its source segment |
| P0-09 | English transcription | Normalized WER ≤15% on the clean benchmark |
| P0-10 | Thai transcription | Normalized CER ≤15% on the clean benchmark |
| P0-11 | Transcript timing | At least 95% of evaluated speech boundaries within 500 ms of labels |
| P0-12 | Silent/non-speech footage | Explicit no-speech state; no invented dialogue |
| P0-13 | Visual grounding | At least 90% of reviewed factual observations supported by cited frames |
| P0-14 | Search | Relevant source appears in top five for ≥80% of 20 labeled Thai/English queries |
| P0-15 | Technical quality scoring (0I) | Controlled blur/darkness degrades the corresponding available component in ≥90% of fixture pairs; method/evidence/rubric recorded; not a gate for editorial scoring in 0E |
| P0-16 | Partial failure | Failed stage is visible and retryable; completed artifacts remain available |
| P0-17 | Browser closes | Jobs continue; reopening shows persisted state |
| P0-18 | Worker terminates | Lease recovery completes the job without duplicate published analysis |
| P0-19 | Local startup without login/cloud storage | Upload → analysis → source playback works with a local owner, local PostgreSQL, and local media storage; no hosted Supabase credentials/payment required |
| P0-20 | Configurable admission | Default and reduced-limit policies take effect in UI/API/worker without code/schema changes; existing accepted versions remain unchanged |
| P0-21 | Concurrent upload reservations | Committed usage plus live reservations cannot exceed configured slots/bytes; duplicate finalize accounts once; actual duration admission is atomic before paid analysis |
| P0-22 | Interrupted/expired/rejected intake | Valid resume reuses reservation; expiry/cancellation/rejection releases capacity once and schedules incomplete-media cleanup; disk remains accounted until deletion |
| P0-23 | Configurable frame sampling | Interval/cap changes are recorded, respected, and deterministic; unsampled intervals and reduced coverage are visible |
| P0-24 | API spending guardrail | Spent plus reserved/uncertain cost is checked atomically before each bounded paid stage/retry; missing/insufficient budget pauses work without a new request |
| P0-25 | Bounded retry and subprocess timeout | Configured maximum attempts/backoff honored; hung subprocess terminated within configured timeout/termination grace; completed stage artifacts retained |
| P0-26 | Concurrency ceiling | Multiple claimers respect configured total and per-class limits; queued work waits and no excess heavy job starts |
| P0-27 | Pause/resume | Queued jobs pause immediately, running jobs checkpoint; persisted reason survives restart; resume revalidates budget/dependencies/capacity without repeating completed stages |
| P0-28 | Cancellation/dependency failure | Cancellation wins over pause and blocks publication; failed/cancelled prerequisite pauses dependents; explicit retry links to prior job without resetting history |
| P0-29 | Temporary cleanup | Success/failure/cancellation/pause and restart sweep remove eligible temp files within configured policy; live leases, durable checkpoints, originals, and retained artifacts are preserved |
| P0-30 | Analysis cache hit | Reopening, searching, or duplicate ordinary submission reuses matching verified analysis with zero additional analysis API calls |
| P0-31 | Selective invalidation | Sampling change reruns affected visual stages without retranscribing unchanged audio; force-rerun records cause/cost and preserves prior revision |
| P0-32 | Canonical media and mapping | Working H.264/yuv420p/square-pixel/30 fps profile and applicable AAC 48 kHz stereo verified; VFR map accounts for duplicates/drops; delayed audio/chunk overlaps stay synchronized |
| P0-33 | Local storage contract | Originals/working/temp/exports use backend/namespace/key references under configured roots; content hashes stable, no absolute paths or expiring URLs persisted as identity |
| P0-34 | Configured capability boundaries | Fixtures at default file-count/size/aggregate/duration limits and supported 4K/60 fps are accepted; just-over-limit cases rejected before expensive analysis; resource failure remains recoverable |

### Additional version 0.3 gates

| ID | Scenario | Pass condition |
|---|---|---|
| P0-35 | Technical-only 0E | With OpenAI configuration absent, local probing/normalization/segmentation/sampling complete; no AI SDK/call required, no fabricated transcript/roles/scores; configured executable paths and PATH fallback tested |
| P0-36 | Technical persistence and migration safety | Fresh and existing 0D databases upgrade through additive migrations; original uploads/reservations preserved; canonical metadata/artifacts/segments/frames have project-safe references, constraints and indexes; completed technical stages survive restart and reuse verified caches |
| P0-37 | Transcript intelligence (0F) | Thai/English/mixed units retain timestamped sentence/semantic boundaries and quote context; negations/qualifications preserved; missing speaker support yields unknown labels, never fabricated identity; mixed-language benchmark meets preregistered threshold |
| P0-38 | Visual temporal evidence (0G) | People/objects/setting/action/shot/composition/text/demonstration/before-after/change observations cite sampled frames/intervals; unobserved time and uncertain claims explicit; still images do not imply continuous action or causation |
| P0-39 | Semantic multi-role contract (0H) | All 16 PRD roles are valid controlled labels; multiple independent [0,1] confidences can coexist, evidence/rationale/provenance required; confidence need not sum to one; abstain on insufficient evidence; optional subtypes validate under parent/version |
| P0-40 | Semantic evaluation (0H) | Held-out multi-label evidence meets the preregistered role/grounding rubric; report per-role errors, abstention, coverage and disagreement; LOW_VALUE requires reasons, authority/proof cannot invent facts |
| P0-41 | Explainable editorial quality (0I) | All 13 PRD components supported with nullable scores, applicability, rationale, evidence, rubric and uncertainty; context-dependent assessments identify context; no universal objective-truth total or conversion guarantee |
| P0-42 | Best-take groups (0I) | Transcript similarity, delivery, visual/audio quality, completeness and usefulness inform explained rankings; equivalent-take and false-merge evaluation meets frozen rubric; changed negations/qualifications retained; no deletion, all alternatives inspectable/overrideable; no embeddings |
| P0-43 | Footage Library (0J) | Persisted metadata, transcripts, visual evidence, roles, quality and take groups can be filtered/retrieved and played at correct source times; reload/search causes no source re-analysis; unknown and unsampled intervals remain explicit |

WER means word error rate; CER means character error rate. These are proposed clean-fixture thresholds. Noisy audio is reported separately and must not be hidden inside the clean benchmark average.

## 4. Phase 1 acceptance tests

| ID | Scenario | Pass condition |
|---|---|---|
| P1-01 | Sufficient footage | Exactly three valid, complete storyboard options |
| P1-02 | Distinct options | Human review confirms different structures/emphases, not title-only variation |
| P1-03 | Grounding | Every proposed beat references real, authorized source intervals |
| P1-04 | Insufficient footage | Clear insufficiency result; no fabricated shots or statements |
| P1-05 | Story selection | Selected storyboard ID and snapshot persist correctly |
| P1-06 | EDL creation | Schema and semantic validation pass before rendering |
| P1-07 | Invalid source range | Negative, empty, or out-of-bounds ranges are rejected |
| P1-08 | Cross-project source | Rejected before media retrieval |
| P1-09 | Actual rendering | Nonempty MP4 downloads and fully decodes |
| P1-10 | Clip fidelity | Source clips and order match the EDL, checked with timecoded fixtures |
| P1-11 | Duration | Video duration within one output frame of EDL; container duration within 100 ms |
| P1-12 | Audio synchronization | Marker mismatch ≤100 ms throughout the output |
| P1-13 | Missing audio | Correct-duration silence inserted; concatenation succeeds |
| P1-14 | Preview/download | Both use the same verified artifact and EDL version |
| P1-15 | Render failure | No success state or broken download presented |
| P1-16 | Render retry | One logical successful output; earlier valid artifacts preserved |
| P1-17 | Initial portrait export | FFmpeg produces verified 1080 × 1920, 30 fps, H.264/yuv420p MP4 with AAC 48 kHz stereo; 1:1/16:9 are not required in Phase 1 |
| P1-18 | Safe fit on mixed orientations | Landscape, square, portrait, and rotation fixtures preserve the complete image and proportions with centered padding; no stretching or silent crop |
| P1-19 | Clip review and analysis reuse | Remove/reorder/replace/trim yields validated immutable versions and correct render; story generation, edits, and render retries make no unnecessary analysis API calls |
| P1-20 | Quantization and historical media | Nearest-frame/ties-up and exclusive-end rules pass boundary cases; referenced asset deletion blocked; older EDLs retain exact working artifacts/analysis |
| P1-21 | Render identity/cache | Equivalent rendering content can reuse verified output despite different version metadata; caption/crop/audio/source/profile/toolchain changes invalidate the relevant render key |
| P1-22 | Objective-conditioned Creative Director | Creative Brief → Creative Director → Three Story Concepts → Shot Selection → Validated EDL → FFmpeg Render succeeds; briefs cover Meta Lead Ad, Conversion / Sales, Awareness, Educational, Organic Social, Testimonial and Personal Brand; same evidence under contrasting objectives produces justified differing selection/emphasis, not a mandatory universal structure |
| P1-23 | Context, evidence and cache reuse | Brief-specific relevance/rankings reference frozen source evidence and brief hash; changing brief does not reprobe/retranscribe/reanalyze unchanged footage; chosen takes preserve meaning and required qualifications; unsupported beats produce gaps rather than invention |

## 5. Phase 2 acceptance tests

| ID | Scenario | Pass condition |
|---|---|---|
| P2-01 | Remove second clip | Only requested clip removed; duration and captions recomputed |
| P2-02 | Reorder clips | New order matches instruction; source intervals retained |
| P2-03 | Replace blurry shot | Valid available replacement proposed; missing alternatives explained |
| P2-04 | Make 30 seconds | When feasible, output falls within ±1 second; otherwise explains constraint |
| P2-05 | Ambiguous reference | Clarification requested; active EDL unchanged |
| P2-06 | Unsupported effect | Clear unsupported response; no invented implementation |
| P2-07 | Concurrent edit | Stale base version detected; no silent overwrite |
| P2-08 | Apply edit | New immutable EDL and newly verified MP4 produced |
| P2-09 | Restore | Earlier content restored through a new version |
| P2-10 | Caption timing | Cues follow retained speech and remain inside output duration |
| P2-11 | Caption correction | Corrected text appears in render and SRT; original transcript retained |
| P2-12 | Thai captions | Correct glyphs/shaping; no clipping, missing characters, or broken wraps |
| P2-13 | All ratios | Exact 1080×1920, 1080×1080, and 1920×1080 outputs |
| P2-14 | Safe fit | Entire source image remains visible when fit is selected |
| P2-15 | Crop persistence | Saved crop matches the output and survives reopening |
| P2-16 | New render pending | Previous video remains playable and clearly labeled |

Caption correction changes output cues/SRT while leaving original analysis/search unchanged. Ratio changes, caption corrections, and restore must reuse valid source analysis. Restoring equivalent content may reuse an existing verified export through the render-content key while retaining a new EDL version.

## 6. Security, recovery, and operating tests

| ID | Scenario | Pass condition |
|---|---|---|
| SYS-01 | Multi-user production gate: user B requests user A's data | Authenticated database/API/search/storage access denied through ownership checks and RLS; not a local Phase 0 gate |
| SYS-02 | Secret inspection | No privileged keys in browser bundle, network payloads, or logs |
| SYS-03 | Malicious filename | No shell execution or path traversal |
| SYS-04 | Prompt injection in footage | Cannot alter permissions, commands, or system rules |
| SYS-05 | Provider timeout/rate limit | Bounded retry; clear final status; completed work retained |
| SYS-06 | Duplicate job delivery | No duplicate published versions or corrupt artifacts |
| SYS-07 | Worker dies during upload of output | Partial artifact never becomes downloadable as complete |
| SYS-08 | Cancel job | Stops at the next safe checkpoint and cleans temporary files |
| SYS-09 | Project deletion during job | New application access/publication blocked; worker cannot publish; artifact removal follows documented retention and issued-URL policy |
| SYS-10 | Budget ceiling | Further paid processing pauses before the next bounded stage |
| SYS-11 | Low disk or memory limit | Recoverable failure; no false success or lost previous output |
| SYS-12 | Repeat identical render | Valid cached artifact reused when all cache keys match |
| SYS-13 | Performance benchmark | Measured against Phase 0/1 targets with hardware and queue time reported |

### Gate assignment

All new version 0.3 gates remain planned until evidence is recorded. Previous 0A–0D checks remain regression requirements; do not claim this documentation edit reran them.

| Stage | Required gates |
|---|---|
| 0A–0D regression | Existing foundation/database/project/upload tests; P0-01–03, upload-only portions of P0-20–22/P0-33; preserve originals and migration history |
| 0E — Technical Media Intelligence | P0-04–08, P0-16–18; local technical portions of P0-19–23, P0-25–30, P0-32–36; P0-31 selective technical invalidation; no paid-provider gate |
| 0F — Transcript Intelligence | P0-09–12, P0-24, P0-37; paid retry/budget/pause/cache portions of P0-16–18/P0-25–31; mixed-language benchmark |
| 0G — Visual Intelligence | P0-13, P0-23, P0-38; full visual sampling/transcript-independent invalidation of P0-31 |
| 0H — Semantic Video Intelligence | P0-39–40; semantic evidence/schema, context and selective cache invalidation |
| 0I — Quality + Best Take Intelligence | P0-15, P0-41–42; explainability, nullable components and non-destructive grouping |
| 0J — Footage Library | P0-14, P0-43; integrated P0-19 workflow; all P0-01–43 and applicable Phase 0 system gates complete |
| Phase 1 | P1-01–23 plus prior gates; creative objective selection, validated immutable EDL and 1080 × 1920 safe-fit FFmpeg export |
| Phase 2 | P2-01–16 plus prior applicable gates; analysis reuse for captions/ratios/restore |
| Phase 3 / deployment | SYS-09 deletion/retention; SYS-01 authenticated RLS/cloud isolation before any multi-user deployment |

Phase 0E system gates: SYS-02–03, SYS-06–08 for technical artifacts/jobs, SYS-11, technical cache reuse, and resource/performance measurement. SYS-04 prompt-injection checks start with AI stages; SYS-05 provider failures and SYS-10 spending checks start before paid calls in 0F. All Phase 0 system obligations carry forward; SYS-13 full-analysis timing is measured by 0J, provisionally. Phase 1 adds SYS-07 for final exports, SYS-12 render cache and the render portion of SYS-13.

Local checks throughout include loopback binding, allowed-origin checks, project isolation, protected server secrets, path traversal prevention and rejection of no-login mode for multi-user production. No paid Supabase or authentication gate blocks local 0E. A future requirement mapped to a later gate cannot silently block 0E.

## 7. Release evidence

For each critical test, retain:

- Fixture/version identifier.
- EDL and render identifiers.
- Expected versus actual result.
- Relevant validation output.
- Screenshot or video where visual behavior matters.
- Failure severity and resolution.

Functional, security, and data-integrity tests gate their assigned phase/deployment scope. The local Phase 0 gate does not require production login/RLS or hosted storage. All applicable tests must pass before the corresponding release. Performance thresholds are provisional until benchmarked; any revision must be explicit and documented.

## 8. Planning review

The five documents are internally aligned on:

- Local single-user development without login or paid cloud storage.
- A PostgreSQL polling/claiming worker; no Redis or BullMQ.
- AI Creative Director + AI Video Editor with technical → temporal → transcript → visual → semantic → quality/best-take → knowledge-base evidence.
- Phase 0E–0J boundaries; 0E uses deterministic processing and requires no OpenAI.
- Extensible multi-role taxonomy, optional HOOK/CTA subtypes, independent confidence, evidence and abstention.
- Explainable quality and non-destructive best-take ranking; creative objectives guide selection rather than one universal structure.
- Minimal additive technical persistence now; future AI/brief/story/render structures added only at their phases.
- Three grounded story options.
- A single, versioned EDL contract.
- FFmpeg-only Phase 0/1 media pipeline and verified 1080 × 1920 (9:16) Phase 1 MP4 rendering; Remotion deferred beyond Phase 1.
- Natural-language changes as validated new versions.
- Subtitles and later 1:1/16:9 additions in Phase 2.
- Configurable limits/sampling, spending guardrails, bounded retries/timeouts/concurrency, temporary cleanup, and resumable reservations/jobs.
- Canonical timestamp mapping, immutable media/edit versions, analysis caching, and no unnecessary re-analysis.
- Keyword-based retrieval without embeddings/vector search throughout the MVP.
- Lowercase `references/`, distinct from labeled evaluation fixtures.

**Current stop point: five planning documents updated to version 0.3 only. Phase 0A–0D remain the completed baseline. New 0.3 acceptance gates have not been executed; Phase 0E implementation requires a subsequent instruction.**
