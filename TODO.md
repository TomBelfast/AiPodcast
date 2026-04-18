# TODO: Pipeline B on `.54`

## START HERE

This file is the canonical working plan for Podcast Film / Pipeline B on `.54`.

### Product Contract

- Matrix / `.35` sends **raw text** for Pipeline B.
- AiPodcast / `.54` is responsible for turning that raw text into a podcast/dialogue with role split.
- Once dialogue exists, the existing downstream Workflow B stays the same:
  - segment normalization
  - OmniVoice or ElevenLabs TTS
  - SoulX render per segment
  - ffmpeg concat
  - 9:16 cover composite
  - captions and final MP4
- Later Matrix work:
  - expose available OmniVoice voices in the UI
  - pass selected voice IDs through to Workflow B
  - this is **not** the current blocker for v1

## Current Implementation Status (2026-04-18)

- `POST /api/podcast-video/podcast-film/jobs` already exists in this repo.
- Pipeline B now supports three practical input shapes:
  - `conversation[]`
  - `transcript` with `[Speaker_N]:` markers
  - raw text, which is internally converted into `conversation[]` through `/api/generate-podcast`
- The downstream B path is live after dialogue exists:
  - OmniVoice registry fetch from `.13:7001 /voices`
  - OmniVoice TTS call to `.13:7001 /api/v1/podcast-film/jobs`
  - SoulX render call to `.13:7000 /generate` per segment
  - ffmpeg concat (hard cut, no crossfade)
  - 9:16 branded cover compositing (1080x1920)
  - `captions.srt` generation
  - burned captions MP4
- Artifact serving is already wired for: `json`, `mp3`, `srt`, `mp4`, `stem1`, `stem2`, `segment`.
- Historical alias compatibility is restored:
  - `host_a` -> `obea`
  - `host_b` -> `okarlik2`
- Route internals now work in this order:
  - `segmentsFromConversation(...)`
  - `parseTranscriptToSegments(...)`
  - raw text fallback: internal `/api/generate-podcast` -> `conversation[]` -> Workflow B segments
- Generated conversation speaker labels `Speaker1` / `Speaker2` and `Antoni` / `Zofia` are explicitly mapped onto `voice1` / `voice2`.

## Caption Audit — Verified on `.54`

- Pipeline B subtitle text comes from the original segment text, not Whisper transcription.
- Pipeline B timing uses Whisper word timestamps only as timing input, reconciled back onto the original segment text.
- Pipeline B burns word-level ASS highlight captions, not plain SRT-only subtitles.
- All captions (burned ASS + standalone SRT) are forced UPPERCASE via `toCaptionCase` helper (`toLocaleUpperCase('pl-PL')`) — 3 render sites in `route.ts`, deployed and verified 2026-04-18.
- Polish glyphs (Ł, Ż, Ś, etc.) render correctly in DejaVu Sans burned captions.
- Captions anchored TOP (ASS `Alignment=8`) with `MarginV=1390` from top — fixed top position just below photo slot; multi-line cues grow DOWNWARDS, never invade the video frame.
- Pipeline A highlight logic still uses native `transcript.words[]` timing data and remains a richer reference implementation.

## 9:16 Cover Overlay — Live on `.54`

- Final output is now `1080x1920` (verified via `ffprobe`).
- Branded template: `/root/AiPodcast/podcast_cover.png` (header "AI W BIZNESIE PL" + "Ai podcast", photo slot, bottom caption strip).
- Photo slot measured: `x=0, y=420, w=1080, h=940`.
- SoulX 512x512 output is scaled to 1080x1080 (lanczos) and center-cropped to 1080x940, placed at `y=420` so the video exactly replaces the host-photo rectangle — no drift between speakers.
- Frame 0 (video poster/thumbnail) intentionally shows the raw cover (no video overlay, no captions) — video overlay and captions both start from the second frame onwards.
- Transition between segments is a hard cut (`transition: 'none'` default).

## Thumbnail Title — Live on `.54`

- Optional `title` field in job payload (string).
- If present, a custom title is drawn on the bottom dark strip of the cover at `y=1480`, centered, white, DejaVu Sans Bold 64pt.
- Visible only on the thumbnail (first `CAPTION_START_DELAY_SECONDS = 0.12s`), driven by ffmpeg drawtext `enable='between(t,0,0.12)'`.
- Disappears as soon as playback starts; captions take over the bottom strip.
- Implementation: `title.txt` written to job dir, referenced via drawtext `textfile=` param so Polish glyphs (Ą/Ł/Ś/Ż) render correctly.
- If `title` is missing / empty, no drawtext filter is added (unchanged behaviour).
- No auto-wrap for long titles — caller can pass `\n` manually if needed.

## `.35` Proxy Path — Verified on 2026-04-18

- Matrix frontend (`/opt/SocialMedia/frontend/src/components/App/PhaseDetails/Phase04_Social.tsx`) calls `${API_BASE_URL}/api/podcast-video/podcast-film/jobs` for Podcast Film.
- Backend proxy (`/opt/SocialMedia/backend/app/api/routers/tasks.py:916`) forwards to `http://192.168.0.54:3300/api/podcast-video/podcast-film/jobs` with `x-api-key`.
- Body passes `title`, `language`, raw `transcript`, `tts_engine`, `voice1`/`voice2`, plus `_PODCAST_FILM_PASSTHROUGH_FIELDS` (all caption_* + soulx_model + transition + use_face_crop + image_rotation_seed).
- Passing raw transcript from Matrix is correct for the intended product contract.
- `.54` now accepts that raw transcript path and generates the podcast/dialogue internally before OmniVoice/SoulX.
- `title` from Matrix (`lastWebhook.title`) flows to `.54` and is now burned on thumbnail frame 0 automatically — no frontend change needed.
- `.35` env: `PODCAST_FILM_VIDEO_API_URL` and `PODCAST_API_KEY` both set and matching `.54`.
- Network path `.35 → .54:3300` confirmed (401 without key, 400 with key + empty body = auth and routing both work).
- Pipeline A (`/api/podcast-video/jobs`) still responds on `.54` (smoke returned 400 on empty body — not regressed by Pipeline B changes).

## Smoke Status — Verified on 2026-04-18

- Speaker-marked end-to-end smoke passed:
  - direct POST to `.54/api/podcast-video/podcast-film/jobs` with 4 `[Speaker_N]:` segments produced a full `1080x1920` MP4 (53.4s, 10.8 MB, audio OK)
  - job id `pbfilm_e2af1547858546f88994c1892d8530e1`
  - timings: OmniVoice 59.2s, SoulX total 107.9s, composite 36.8s, captions 13.1s
  - `caption_matched_words=137`, `caption_unmatched_words=2`, no caption warnings
- Raw-text dry run now passes:
  - direct POST with raw `transcript` and `dryRun=true` returned `segments_count=8`
  - confirms internal `raw text -> /api/generate-podcast -> conversation[] -> segments` flow works
- Raw-text full Workflow B smoke passed:
  - direct POST with raw `transcript`, `dryRun=false`, `captions=off`
  - job id `pbfilm_2961ea51b6c8491497098e31b2ba6273`
  - returned final MP4 URL and SRT URL successfully
  - timings: OmniVoice 186259ms, SoulX total 215958ms, concat 190ms, composite 53110ms
- This confirms the product-correct raw-text path is now live on `.54`.

## What Is Still Open

### 1. Caption alignment quality (deferred)

- Visual QA on 2026-04-18 confirmed the current greedy window=3 aligner is "good enough" in live output.
- Keep this open only if future smokes show `caption_unmatched_words` spiking or visible timing drift.
- Candidate upgrade if revisited: fuzzy match (Levenshtein) + wider window + DP alignment instead of greedy.

### 2. Verification

- Verify `.54 -> .13:7001` and `.54 -> .13:7000` health + live job path.
- Verify `.35 -> .54` proxy path.
- Verify existing Static Video flow still behaves unchanged.
- Verify final MP4 + SRT URLs are fetched correctly by the client.
- Re-run a full raw-text smoke with burned captions enabled. The successful implementation smoke intentionally used `captions=off` to isolate the new generation stage plus video pipeline.
- Run the same raw-text smoke through the real Matrix / `.35` product path, not only by direct local POST on `.54`.

## Where To Run Next Steps

- **Najlepsza maszyna do dalszych testów backendowych: `.54` (`Podcast` / `AiPodcast`)**
  - tu są route, `.env.local`, logi, archiwum jobów i smoke scripty
  - to jest najtańsze miejsce do iteracji nad Workflow B
- **`.35` używaj tylko do testu prawdziwej ścieżki produktowej Matrix -> proxy -> `.54`**
  - nie debuguj tam codziennie backendu, bo każdy pełny retry z raw text może znów odpalić `/api/generate-podcast` i spalić tokeny
- **`.13` używaj tylko do workerów**
  - OmniVoice `:7001` health / restart / logi
  - SoulX `:7000` health / restart / logi
  - nie testuj tam orkiestracji AiPodcast

## Environment Note (2026-04-18)

- Access ports changed on `.13`:
  - OmniVoice now uses `:7001`
  - SoulX now uses `:7000`
- `.54` should use `OMNIVOICE_BASE_URL=http://192.168.0.13:7001` and `SOULX_BASE_URL=http://192.168.0.13:7000`.

## Cheapest Test Order

- 1. Na `.54`: `dryRun` z raw text, gdy zmieniasz etap generowania podcastu lub segmentacji.
- 2. Na `.54`: speaker-marked `dryRun`, gdy debugujesz tylko downstream i nie chcesz odpalać generatora rozmowy.
- 3. Na `.54`: pełny smoke z raw text dopiero wtedy, gdy poprzednie dwa kroki są zielone.
- 4. Na `.35`: pojedynczy smoke produktowy dopiero po stabilizacji `.54`.

## Later

- Add a Matrix UI selector for available OmniVoice voices and pass the chosen IDs into Workflow B.
- `/root/AiPodcast/config/voice-catalog.json` on `.54` remains the source of truth for that future UI.
- This UI work is intentionally deferred until after the raw-text Workflow B path is working.

## Important Facts

- Default transition: `none` (hard cut). `transition_duration` still accepted but unused for hard cut.
- Default caption mode: `burn`.
- Default caption style: `highlight`, font size 76, `MarginV=1390` (top-anchored, Alignment=8), color `#00FF04` (word) + `#FFFFFF` (line).
- Caption output preserves original dialect text; Whisper only reconciles timing.
- All caption output is UPPERCASE (burned + SRT) — one-line rollback via `toCaptionCase` helper.
- Captions shifted by `CAPTION_START_DELAY_SECONDS = 0.12s` so frame 0 stays clean (thumbnail has no captions).
- Cover overlay constants in `route.ts`: `COVER_OVERLAY_Y=420`, `COVER_OVERLAY_W=1080`, `COVER_OVERLAY_H=940`. Change these if cover artwork changes.
- Title constants in `compositeOnCover`: font `DejaVuSans-Bold.ttf`, size 64, color white, y=1480, visible during first 0.12s only.
- Final output resolution: `1080x1920` (portrait 9:16).
- Product contract for Pipeline B is **raw text from `.35` to `.54`**.
- Speaker-marked transcript remains a technical smoke/debug input and back-compat path; the product-correct path is now the raw-text route.

## Do Not Redo

- Do not rebuild the whole Pipeline B route from scratch.
- Do not move orchestration back to `.35`.
- Do not replace original subtitle text with Whisper transcription for dialect-heavy content.
- Do not reintroduce the intro title-card — user wants the first playable frame to already be the composited overlay.
- Do not reintroduce crossfade between segments — user confirmed hard cut.
- Do not change the cover overlay rectangle unless the cover PNG itself changes — current values match the photo slot exactly.
- Do not remove `CAPTION_START_DELAY_SECONDS` — it is what keeps frame 0 caption-free for the poster/thumbnail.
- Do not move the thumbnail title out of the bottom strip unless the caption position also changes — they share that area intentionally (title disappears before captions appear).
- Do not treat speaker-marked transcript as the permanent product contract for Matrix; the product contract is raw text from `.35` and podcast/dialogue generation on `.54`.
