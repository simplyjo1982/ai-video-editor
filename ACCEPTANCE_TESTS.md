# ACCEPTANCE_TESTS.md

**Status:** Planned tests; not yet executed  
**Version:** 0.2

## 1. Test principles

- Critical workflow tests use real media and real FFmpeg output.
- Provider mocks test error handling, but cannot prove AI quality.
- Release evaluation includes real OpenAI calls on approved test footage.
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

Include human-labeled transcripts, scene boundaries, relevant search results, and expected render source order.

### Fixture manifest and evaluation protocol

- Keep test fixtures separate from `references/`. The current `references/reference-video.mp4` is a promotional design reference, not proof of media correctness or AI quality. Record origin, rights, checksum, and timecoded reference notes before redistribution; its prior visual observations were not independently replayed in the assessment.
- Each fixture manifest records license/consent, checksum, duration, codec/profile, orientation, frame-rate/timebase, audio offsets, labels, and expected artifacts. Large fixtures may be generated deterministically later; record recipe/tool versions and checksums instead of committing large binaries blindly.
- Freeze evaluation fixtures before tuning final acceptance thresholds. Include separate tuning and held-out sets. Minimum clean evaluation: five distinct recordings and five minutes of speech each for English, Thai, and mixed Thai/English; report per-recording and aggregate results.
- Normalize labels/predictions consistently: Unicode NFC, declared punctuation/whitespace rules, and English case folding. Do not remove Thai combining marks or silently normalize away meaningful errors. Version the normalization rules. English WER and Thai CER retain the thresholds below; mixed-language scoring/threshold must be fixed and documented before paid benchmark evaluation, and reported separately from monolingual/noisy results.
- Label at least 40 hard cuts, 40 speech boundaries per language category, and 50 factual visual observations across assets. Review narrative distinctness/grounding with two reviewers using a written rubric; resolve disagreements and report sample counts. Assess preserved meaning as well as valid timestamps.
- Search baseline: 20 labeled queries, split equally between Thai and English, covering metadata, tags, transcript, and description keywords; report each language separately and combined. Add mixed-language queries as a separately reported set.
- Include all configured-limit boundaries and concurrency races, plus full-limit media capability fixtures separate from the five-file performance benchmark. Smaller test quotas alone do not validate 4K/60 fps or the default 30-minute capacity.
- Record cold versus cached runs, effective policy, API call counts/cost reservations, hardware, peak memory/disk, model/prompt/FFmpeg versions, and fixture IDs. Acceptance tests remain planned until evidence is captured.

## 3. Phase 0 acceptance tests

| ID | Scenario | Pass condition |
|---|---|---|
| P0-01 | Upload five videos | Five distinct assets reach completed upload state |
| P0-02 | Interrupt upload | Transfer resumes without creating a duplicate asset |
| P0-03 | Exceed limits | Clear rejection; expensive analysis does not start |
| P0-04 | Probe media | Metadata matches fixture ground truth; duration within 100 ms |
| P0-05 | Normalize VFR/rotation | Correct orientation; constant 30 fps; no accumulated A/V drift over 100 ms |
| P0-06 | Detect known hard cuts | Precision and recall each ≥90% on labeled hard-cut fixtures, within 250 ms |
| P0-07 | Continuous scene | Valid analysis without requiring an artificial shot boundary |
| P0-08 | Extract frames | Every frame has a valid artifact and timestamp within its source segment |
| P0-09 | English transcription | Normalized WER ≤15% on the clean benchmark |
| P0-10 | Thai transcription | Normalized CER ≤15% on the clean benchmark |
| P0-11 | Transcript timing | At least 95% of evaluated speech boundaries within 500 ms of labels |
| P0-12 | Silent/non-speech footage | Explicit no-speech state; no invented dialogue |
| P0-13 | Visual grounding | At least 90% of reviewed factual observations supported by cited frames |
| P0-14 | Search | Relevant source appears in top five for ≥80% of 20 labeled Thai/English queries |
| P0-15 | Quality scoring | Controlled blur/darkness degrades the corresponding score in ≥90% of fixture pairs |
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

- Phase 0: P0-01–P0-34; SYS-02–SYS-06, SYS-08, SYS-10, SYS-11; SYS-07 applied to analysis artifacts; Phase 0 portion of SYS-13 is measured with provisional performance target.
- Phase 1: all Phase 0 gates remain; P1-01–P1-21, SYS-07 for final exports, SYS-12, and Phase 1 portion of SYS-13.
- Phase 2: P2-01–P2-16 and prior applicable gates, including analysis reuse for captions/ratios/restore.
- Phase 3/deployment readiness: SYS-09 and complete deletion/retention evidence; SYS-01 and full authenticated RLS/cloud isolation are mandatory before any multi-user production deployment, even if deployment is attempted earlier. Authentication does not gate local Phase 0.
- Local-mode checks from Phase 0 include loopback-only binding, allowed-origin checks, project-reference isolation, protected server secrets, path traversal prevention, and rejection of no-login mode in multi-user production configuration.

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
- Evidence-linked footage understanding.
- Three grounded story options.
- A single, versioned EDL contract.
- FFmpeg-only Phase 0/1 media pipeline and verified 1080 × 1920 (9:16) Phase 1 MP4 rendering; Remotion deferred beyond Phase 1.
- Natural-language changes as validated new versions.
- Subtitles and later 1:1/16:9 additions in Phase 2.
- Configurable limits/sampling, spending guardrails, bounded retries/timeouts/concurrency, temporary cleanup, and resumable reservations/jobs.
- Canonical timestamp mapping, immutable media/edit versions, analysis caching, and no unnecessary re-analysis.
- Keyword-based retrieval without embeddings/vector search throughout the MVP.
- Lowercase `references/`, distinct from labeled evaluation fixtures.

**Current stop point: planning documents updated to approved decisions. Tests have not been executed; implementation has not begun and requires a subsequent instruction.**
