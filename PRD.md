# PRD.md

**Status:** Phase 0A–0D completed; version 0.3 planning revision only; Phase 0E not started

**Version:** 0.3

**Product:** AI Creative Director + AI Video Editor

## 1. Product objective

Turn a collection of raw footage into a coherent, editable short video without requiring professional editing skills. The product is an AI Creative Director + AI Video Editor: it builds structured editorial understanding, then selects a story for a specific creative objective. Transcription and description are evidence layers, not the finished intelligence product.

**Video intelligence pipeline:**

Uploaded Media → Technical Media Intelligence → Temporal Segmentation → Transcript Intelligence → Visual Intelligence → Semantic Video Intelligence → Quality / Best-Take Intelligence → Footage Knowledge Base → Creative Director → Storyboard → EDL → Render.

Phase 0A–0D already provide the local foundation, PostgreSQL, projects, and resumable uploads. This revision plans the next stages; it does not implement Phase 0E.

The core experience:

1. Upload multiple videos.
2. Analyze the footage.
3. Review what the system found.
4. Capture a creative brief and let the Creative Director propose three grounded story concepts, each expressed as a storyboard.
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
| Baseline inputs | MP4/MOV/M4V upload containers; Phase 0E validates SDR H.264 video with AAC audio or no audio; upload acceptance alone does not prove codec compatibility |
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
| F02 | Technical Media Intelligence | Duration, dimensions, rational frame rate, codecs, audio streams, orientation, CFR/VFR evidence, and timestamp normalization |
| F03 | Temporal segmentation | Identify candidate shot boundaries and useful editorial intervals; support a continuous shot; semantic scenes later |
| F04 | Audio extraction | Extract analysis audio while preserving synchronization information |
| F05 | Transcript Intelligence | Timestamped Thai/English/mixed speech, sentence/semantic units, useful quotes, optional justified speaker labels |
| F06 | Frame extraction | Representative frames with exact source timestamps |
| F07 | Visual Intelligence | Evidence-linked people, objects, setting, action, composition, shot type, visible text, demonstrations, before/after imagery, and temporal changes |
| F08 | Search | Metadata, tags, transcript, description keywords; jump to matching footage; no embeddings or vector search in the MVP |
| F09 | Quality / Best-Take Intelligence | Explainable technical/editorial assessments and similar-take candidates, with uncertainty and human override |
| F10 | Creative Director and storyboards | Objective-conditioned selection; exactly three distinct grounded concepts/storyboards when sufficient footage exists |
| F11 | Source selection | Every selected clip has a valid asset and source interval |
| F12 | EDL | Validated, versioned, structured editing specification |
| F13 | Rendering | Produce and verify a real downloadable MP4 |
| F14 | Preview | Play, pause, seek, and identify the rendered version |
| F15 | Natural-language editing | Propose supported edits against a specific version |
| F16 | Subtitles | Editable transcript-derived captions, optional burn-in, SRT export |
| F17 | Aspect ratios | Phase 1: 9:16; Phase 2: add 1:1 and 16:9; preserve source proportions with safe fit/padding |
| F18 | Version history | Preserve previous edits and restore an earlier version |
| F19 | Semantic Video Intelligence | Multiple evidence-linked roles per segment, independent confidence, versioned taxonomy, abstention for insufficient evidence |
| F20 | Footage Knowledge Base | Persisted evidence, roles, quality, take groups, coverage, keyword/filter retrieval; no embeddings |

### Footage understanding

Process every accepted asset through applicable stages, but sampled frames never imply exhaustive understanding of every moment.

| Layer | Required understanding and provenance |
|---|---|
| Technical Media Intelligence (0E) | Duration, coded/display dimensions, rational frame rates, codec/profile, audio stream inventory, rotation/orientation, CFR/VFR/unknown with detection method, original timebases/start PTS, normalization status/profile and timing map |
| Temporal Segmentation (0E foundation) | Candidate shot boundaries and useful editorial intervals, inclusive start/exclusive end, representative frames and exact source mappings; a continuous take is valid |
| Transcript Intelligence (0F) | Timestamped speech, sentence/semantic units, Thai, English and mixed speech, useful quote candidates with context; speaker labels only where technically supported, never inferred identity |
| Visual Intelligence (0G) | People, objects, setting, action, shot type, composition, visible text, before/after imagery, product/service demonstrations, observed changes across time; separate evidence from inference |
| Semantic Video Intelligence (0H) | Multi-role editorial interpretation grounded in transcript/frame/interval evidence, confidence, rationale and coverage limitations |
| Quality / Best-Take Intelligence (0I) | Explainable technical/editorial components; candidate repeated takes grouped and ranked without deleting or hiding alternatives |
| Footage Knowledge Base / Footage Library (0J) | Inspectable evidence, revisions, roles, quotes, quality, take groups, keyword search/filtering and source playback |

A shot is a visually continuous recording interval; a scene may group shots when supported. Phase 0E detects candidate shot boundaries only, not semantic scenes. Use explicit segment kinds (`shot`, `scene`, `editorial`) and parent links where justified. Do not force transcript units to align with shot cuts. All layers retain their coordinate system and source references. Unknown, unavailable, no-audio and no-speech are distinct from failed analysis.

### Semantic video roles

Use this versioned, extensible controlled taxonomy. Multiple roles can apply to an interval; independent confidence scores (0–1) need not sum to one and are not calibrated probabilities unless validated. Each assignment records evidence references, rationale, taxonomy/schema/model/prompt versions and limitations. Abstain when evidence is insufficient; missing evidence is not LOW_VALUE. Low-value or unusable judgments need reasons and never delete footage automatically.

| Role | Editorial purpose |
|---|---|
| HOOK | Earn attention at the opening |
| PROBLEM | Communicate a problem or unmet need |
| CONTEXT | Explain the situation or background |
| EXPERT_AUTHORITY | Establish relevant expertise without inventing credentials |
| SOLUTION | Explain the proposed solution |
| DEMO | Demonstrate a product, service, procedure or process |
| B_ROLL | Support other story beats visually |
| PROOF | Supply evidence, results or transformation; imagery alone does not establish causation |
| TESTIMONIAL | Present a person's account or endorsement |
| OBJECTION_HANDLER | Address a likely question, concern or objection |
| OFFER | Describe an offer or terms |
| CTA | Invite a next action |
| PAYOFF | Deliver the promised result or narrative resolution |
| TRANSITION | Connect beats or change scene/context |
| DISCLAIMER | Supply qualifications, limitations or required context |
| LOW_VALUE | Identify low editorial value or unusability with specific reasons |

Illustrative estimates, not measured truth:

```yaml
semantic_roles:
  HOOK: 0.93
  PROBLEM: 0.86
  EXPERT_AUTHORITY: 0.52
```

Later HOOK subtypes: question, problem, contrarian, result, price, curiosity, authority, transformation, fear_loss, social_proof, visual.

Later CTA subtypes: hard_cta, soft_cta, offer_cta, urgency_cta, informational_cta, lead_cta.

Subtypes are optional versioned labels under their parent role, not mandatory single-choice fields. They are not required in Phase 0E.

### Quality and editorial intelligence

Plan separate 0–100 component scores for visual quality, sharpness, stability, composition, face visibility, audio quality, delivery quality, emotional impact, story relevance, hook strength, CTA strength, conversion potential, and editorial usefulness. Include exposure/resolution warnings where relevant.

Each available score records evidence, method/rubric version, rationale, uncertainty and applicable context; unavailable or inapplicable components are null with a reason, never invented zeros. Face visibility can be inapplicable to useful B-roll. Label technical measurements separately from subjective editorial judgments. No universal fixed-weight total is authoritative. Any optional aggregate records its available components, weights and normalization; explicitly exclude missing/inapplicable components.

Story relevance and conversion potential depend on the brief and audience; conversion potential is a creative hypothesis, not a predicted business result. Low scores do not automatically exclude footage. Users can inspect evidence and override selection.

### Best-take intelligence

Phase 0I will propose groups of duplicate or semantically similar takes using transcript similarity, delivery, visual quality, audio quality, completeness and editorial usefulness. Use lexical/phrase similarity and deterministic signals first; no embeddings or vector search in the MVP. Record pair/group evidence, scores and uncertainty, preserve all originals, and allow reviewers to reject a grouping or choose another take. Repeated wording does not prove interchangeable meaning; preserve negations, qualifications and context. No best-take detection in Phase 0E.

### Creative context

Support objectives including Meta Lead Ad, Conversion / Sales, Awareness, Educational, Organic Social, Testimonial and Personal Brand. The Phase 1 brief records objective, audience, message, desired action, constraints and target duration. The Creative Director selects structure for that brief; do not hard-code one universal hook/problem/solution/CTA sequence.

Reusable source facts and base role assessments are separate from brief-conditioned relevance/rankings. Changing the objective may change selection and contextual scores but must not retranscribe, reprobe or reanalyze unchanged source footage.

### Cost and phase boundary

Use deterministic FFmpeg / ffprobe processing → segmentation → bounded representative frame sampling → transcript → selective multimodal AI analysis. Never send every frame to an AI model. Persist hashes, versions, coverage and stage cache keys; changed inputs invalidate only dependent stages.

Phase 0E establishes ffprobe, canonical technical metadata, timestamp handling, temporal segmentation and representative-frame extraction foundations, and their minimal persistence. No OpenAI account, key, SDK or paid call is required for Phase 0E; transcription, visual/semantic AI, editorial scoring and best-take detection remain later stages.

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

In local single-user mode without login or paid cloud storage, users can inspect technical, temporal, transcript, visual, semantic-role, quality and best-take evidence in a reusable Footage Library. Phase 0E–0J have separate gates; technical analysis alone is not full editorial understanding. Phase 0 cost/safety controls, caching and recovery must pass their assigned gates.

### Phase 1

A Creative Brief → Creative Director → Three Story Concepts → Shot Selection → Validated EDL → FFmpeg Render workflow lets users choose among three grounded stories and receive an actual playable 1080 × 1920 (9:16) MP4 generated by FFmpeg from a validated immutable EDL, with safe fit/padding.

### Full MVP

Users can request supported changes, generate a new version, add subtitles, and export all three aspect ratios.

Proposed pilot usability target:

- At least four of five representative users complete upload → story selection → download without developer assistance.
- At least four of five rate one proposed story as usable with minor edits.
- All critical acceptance tests pass before release.
