# PRD.md

**Status:** Planning revised to approved MVP decisions; implementation not started  
**Version:** 0.2  
**Product:** AI-first Video Editor

## 1. Product objective

Turn a collection of raw footage into a coherent, editable short video without requiring professional editing skills.

The core experience:

1. Upload multiple videos.
2. Analyze the footage.
3. Review what the system found.
4. Generate three grounded storyboard options.
5. Select a story.
6. Create a structured Edit Decision List, or EDL.
7. Render and preview an actual MP4.
8. Request changes in natural language.
9. Review the changes and render a new version.
10. Export the approved video.

The application must produce usable video files. Story descriptions, mock previews, and placeholder exports do not satisfy the product goal.

## 2. Reference video review

**Reference:** `references/reference-video.mp4`, previously documented as approximately 48 seconds, 360 × 360 pixels.

The prior planning inspection used metadata and sampled visual frames. The subsequent assessment verified the directory inventory but could not independently play the local video because of browser policy. Small interface text was frequently unreadable in the prior inspection; the observations below are that inspection's design notes, not verified backend behavior or an audio transcript. Reference provenance and usage rights remain to be recorded before redistribution; this promotional reference is not an acceptance fixture.

| Reference observation | Product implication |
|---|---|
| Footage library with multiple video cards | Use a visual footage workspace |
| Caption claims ingestion of 100 files | Design for multiple files, but validate a smaller MVP limit first |
| Footage thumbnails and selection screens | Make source material inspectable |
| Storyboard selection appears in the workflow | Offer three understandable narrative options |
| Video preview appears beside written content | Keep the rendered output central to review |
| Voiceover is advertised | Defer generated narration |
| Desktop installation and external AI integration are advertised | Defer desktop packaging and external assistant integration |

The reference does **not** establish rendering reliability, timestamp precision, supported codecs, actual processing speed, or scalability. These require independent tests.

## 3. Target users and jobs

Primary users:

- Marketing teams producing social content.
- Content creators editing interviews, events, demonstrations, and testimonials.
- Small businesses with useful footage but limited editing capacity.

Primary job:

> Help me find the useful moments, choose a story, and turn those moments into a finished short video.

Initial language scope: **Thai and English**, including mixed-language recordings.

## 4. MVP operating limits

These are configurable MVP defaults, not hard-coded architectural limits or claims about provider limits. A validated configuration supplies admission limits to the UI, API, and worker. Each upload/job records its effective configuration version. Changing limits does not rewrite existing media, analysis, or EDLs. Codec support and the EDL v1 30 fps timebase remain explicit versioned capabilities; increasing a quota alone does not add codec support.

| Item | MVP default / capability |
|---|---|
| Ownership | Local single-user development without login; authenticated ownership before multi-user production deployment |
| Files per project | 20 videos |
| Individual file size | 1 GB |
| Total uploaded size | 5 GB per project |
| Total footage duration | 30 minutes per project |
| Individual video duration | 15 minutes |
| Baseline inputs | SDR MP4/MOV containing H.264 video; AAC audio or no audio |
| Input dimensions | Up to 3840 × 2160, including portrait equivalents |
| Input frame rates | Up to 60 fps; variable frame rate accepted through normalization |
| Output duration | 15–90 seconds |
| Output frame rate | Constant 30 fps |
| Output formats | SDR H.264 MP4, yuv420p, square pixels, AAC 48 kHz stereo |
| Export sizes | Phase 1: 1080 × 1920 (9:16); Phase 2 adds 1080 × 1080 (1:1) and 1920 × 1080 (16:9) |

HEVC, HDR, unusual codecs, and unsupported containers receive a clear compatibility message. Their support can expand after the baseline pipeline passes.

The UI validates known limits before upload and validates actual media properties after probing.

### Local development and storage

Phase 0 must run in an explicit local single-user mode without login, Supabase Auth, production RLS, or a paid Supabase storage plan. Retain owner fields and project boundaries for future deployment. This mode is restricted to local development; authentication and RLS are required before multi-user production deployment.

PostgreSQL-backed job records and a polling/claiming worker are required. A local PostgreSQL instance may be used independently of hosted Supabase. Local filesystem storage may hold originals and working media behind the same storage abstraction later used for private Supabase/cloud storage. Keep immutable originals, reusable working derivatives, disposable temporary files, and verified final exports distinct.

### Phase 0 cost and safety controls

- Configurable file count, size, duration, processing, and storage limits.
- Configurable analysis sampling interval, frame cap, and coverage reporting.
- API spending guardrails that reserve estimated cost before a bounded paid stage and pause when budget is unavailable.
- Bounded retries, subprocess timeouts, and configurable concurrency limits.
- Temporary-media cleanup after success, failure, cancellation, and abandoned attempts.
- Atomic upload quota reservations, expiry, retry-safe finalization, and release of unused capacity; final duration admission occurs after probing.
- Persisted pause/resume and cancellation with completed results retained.
- Analysis caching: reopening, searching, story generation, and editing must not unnecessarily re-analyze unchanged footage. Explicit reruns or changed analysis inputs create new revisions.

Uploaded-byte quotas do not include derivative storage implicitly: working media, exports, and temporary disk have separately configured budgets. Retained versions pin the artifacts needed for playback and reproducible rendering.

## 5. Functional requirements

| ID | Requirement | Required behavior |
|---|---|---|
| F01 | Multiple uploads | Per-file progress, retry, resumable transfer, clear errors |
| F02 | Metadata extraction | Duration, dimensions, codec, frame rate, rotation, audio presence |
| F03 | Scene detection | Identify candidate shot boundaries; support one continuous scene |
| F04 | Audio extraction | Extract analysis audio while preserving synchronization information |
| F05 | Transcription | Timestamped Thai/English transcript linked to source video |
| F06 | Frame extraction | Representative frames with exact source timestamps |
| F07 | Visual analysis | Evidence-linked summaries, visible subjects/actions, uncertainty |
| F08 | Search | Metadata, tags, transcript, description keywords; jump to matching footage; no embeddings or vector search in the MVP |
| F09 | Quality scoring | Explainable technical suitability scores and warnings |
| F10 | Storyboards | Exactly three distinct options when sufficient footage exists |
| F11 | Source selection | Every selected clip has a valid asset and source interval |
| F12 | EDL | Validated, versioned, structured editing specification |
| F13 | Rendering | Produce and verify a real downloadable MP4 |
| F14 | Preview | Play, pause, seek, and identify the rendered version |
| F15 | Natural-language editing | Propose supported edits against a specific version |
| F16 | Subtitles | Editable transcript-derived captions, optional burn-in, SRT export |
| F17 | Aspect ratios | Phase 1: 9:16; Phase 2: add 1:1 and 16:9; preserve source proportions with safe fit/padding |
| F18 | Version history | Preserve previous edits and restore an earlier version |

### Footage understanding

The system analyzes every accepted asset, but must not imply that sampled frames provide exhaustive understanding of every moment.

Each asset displays:

- Technical metadata.
- Scene and segment cards.
- Representative frames.
- Timestamped transcript, or explicit no-audio/no-speech status.
- Visual summary and searchable tags.
- Quality breakdown.
- Analysis status and limitations.
- Links back to source playback.

A **scene** represents a detected shot. A **segment** is a time interval used for search and editing; long scenes may contain several segments.

### Footage quality scoring

Technical suitability is separate from narrative relevance.

Proposed score components:

- Sharpness: 30%.
- Exposure usability: 25%.
- Stability: 25%.
- Resolution suitability: 20%.

Available components are normalized to 0–100. If a component cannot be measured, report it as unavailable and renormalize the remaining weights.

Display audio warnings separately: clipping, low level, no audio, or uncertain intelligibility.

Scores are heuristics, not objective judgments of creative value. Low scores must not automatically exclude footage. Users can include flagged clips.

### Three storyboards

Each option contains:

- Title and narrative angle.
- Intended audience and objective.
- Opening hook.
- Ordered story beats.
- Candidate footage and source timestamps for each beat.
- Estimated duration.
- Quality or coverage warnings.
- Brief rationale.

Options must differ in narrative structure or emphasis, not merely their titles.

If three credible stories cannot be supported, explain the gap and request more footage or a different brief. Do not fabricate events, dialogue, or visuals.

### Natural-language editing

Supported examples:

- Make this approximately 30 seconds.
- Start with the product close-up.
- Remove the second clip.
- Replace the blurry shot.
- Move the interview before the demonstration.
- Make the pacing faster using shorter cuts.
- Add or remove subtitles.
- Correct this subtitle.
- Change the output to 1:1 (Phase 2).
- Mute this clip.

Each request produces a proposed change summary. The user chooses **Apply and render**. Clear requests should not trigger repeated conversational clarification; clarification is reserved for ambiguity.

Unsupported requests receive a specific explanation and an available alternative.

## 6. UX structure

| View | Primary content | Primary action |
|---|---|---|
| Projects | Existing projects and processing state | Create project |
| Footage | Upload queue, footage cards, search, analysis | Review footage |
| Story options | Brief and three story cards | Select story |
| Edit review | Ordered clip cards, source ranges, rationale | Render video |
| Video review | Actual MP4, version label, instruction field | Propose changes |
| Export | Ratio, subtitles, render status, download | Export |

Phase 1's ordered clip list supports remove, reorder, replace, and simple in/out adjustment through validated new EDL versions. Phase 2 adds natural-language proposals. Phase 1 defaults to safe fit with centered padding in the 9:16 canvas, preserving the complete source image without stretching. Phase 2 adds explicit saved crop controls; never silently crop to fill.

**There is no professional nonlinear editing timeline in the MVP.**

Additional UX requirements:

- Processing continues if the browser closes.
- Pause, budget pause, resume, and cancellation have explicit persisted states and reasons.
- Failed assets do not hide successfully analyzed assets.
- Users explicitly choose whether to proceed with a ready subset.
- Stage names replace misleading fabricated progress percentages.
- An old render remains playable while a new version renders.
- The UI clearly distinguishes selected edit version from last successful render.
- Keyboard operation and readable processing/error states are required.

## 7. Explicit exclusions

- Advanced color grading.
- Multicam.
- Professional audio mixing.
- Complex VFX.
- Professional timeline tooling.
- Generated video, avatars, or synthetic B-roll.
- Voice cloning or generated narration.
- Music licensing and music-library integration.
- Separate overlapping B-roll/audio tracks.
- Speed ramps and complex transitions.
- Real-time collaborative editing.
- Desktop installers.
- Automatic social publishing.
- Billing and subscription management.
- Redis and BullMQ throughout the MVP.
- Embeddings and vector search throughout the MVP.
- Remotion through Phase 1; any later adoption requires a separate decision.

FFmpeg is the only required media/rendering engine for Phase 0 and Phase 1. The first renderer uses sequential clips, hard cuts, and original clip audio or silence. Optional subtitles arrive in Phase 2.

## 8. Success criteria

### Phase 0

In local single-user mode without login or paid cloud storage, users can upload multiple videos and inspect genuine extracted metadata, frames, transcripts, scene boundaries, summaries, and quality information. Phase 0 cost/safety controls, caching, and recovery must pass their acceptance gates.

### Phase 1

Users can choose among three grounded stories and receive an actual playable 1080 × 1920 (9:16) MP4 generated by FFmpeg from a validated immutable EDL, with safe fit/padding.

### Full MVP

Users can request supported changes, generate a new version, add subtitles, and export all three aspect ratios.

Proposed pilot usability target:

- At least four of five representative users complete upload → story selection → download without developer assistance.
- At least four of five rate one proposed story as usable with minor edits.
- All critical acceptance tests pass before release.
