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
  - OmniVoice registry fetch from `.13:8766 /voices`
  - OmniVoice TTS call to `.13:8766 /api/v1/podcast-film/jobs`
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
- Raw-text full Workflow B smoke with burned captions passed after port fix:
  - direct POST with raw `transcript`, `dryRun=false`, `captions=burn`
  - job id `pbfilm_439a5a3ef13d40aa8f10777c4daf8fe0`
  - returned final MP4 URL and SRT URL successfully
  - final MP4 verified on disk: `90.533s`, `18.5 MB`
  - timings: OmniVoice 82851ms, SoulX total 122916ms, concat 196ms, composite 47796ms, captions 20637ms
- Artifact URL verification passed after route fix:
  - `mp4_url` returns `200 OK` publicly
  - `srt_url` returns `200 OK` publicly after making SRT public like MP4
- This confirms the product-correct raw-text path is now live on `.54`.

## TTS-Aware Generation + Gender Mapping — Live on `.54` (2026-04-18)

- `/api/generate-podcast` now accepts optional `ttsEngine` field.
  - `ttsEngine: 'omnivoice'` prepends a hard rule block forbidding `[laughs]`/`[sighs]`/any bracketed stage directions and em-dash interruptions; schema description also swapped.
  - Default (absent or `'elevenlabs'`) preserves prior behaviour — emotional tags stay in for the ElevenLabs-based Pipeline A / web UI / `/api/v1/generate`.
- Pipeline B (`podcast-film/jobs/route.ts`):
  - Fetches OmniVoice voice registry before speaker→voice mapping.
  - New `resolveGenderedVoicePair(voice1, voice2, registry)` swaps the (Antoni, Zofia) → (voice1, voice2) mapping when voice1 is female and voice2 is male, so the generated grammatical gender always matches the actual voice/image gender. Fallback is positional when both voices share a gender or are unknown.
  - Always passes `ttsEngine: 'omnivoice'` when calling the internal generator.
  - `stripTtsInlineTags()` removes any leaked `[…]` directions and em-dashes defensively before segments hit OmniVoice.
  - Dry-run response exposes `male_voice`, `female_voice`, `voices_swapped_for_gender`, and `segments_preview`.
- Smoke 2026-04-18 (raw-text + dryRun, Polish):
  - `voice1=obea` (female) / `voice2=okarlik2` (male) → `voices_swapped_for_gender=true`; Antoni (male grammar, Silesian) rendered on `okarlik2`, Zofia (female grammar, Goral) rendered on `obea`. No brackets, no em-dashes.
  - `voice1=okarlik2` (male) / `voice2=obea` (female) → `voices_swapped_for_gender=false`; speakers mapped positionally. Cross-gender addressing forms stay consistent (`słyszałaś`, `tyś jest naiwny`).

## SoulX Model Choice — Default Pro (2026-04-19)

- **Default zmieniony z `lite` na `pro`** w `podcast-film/jobs/route.ts` (`soulxModelRaw = String(body.soulx_model || 'pro')`).
- Override per job via `"soulx_model": "lite"` w payloadzie jeśli chcesz taniej/szybciej.
- Matrix `.35` proxy forwarduje `soulx_model` przez `_PODCAST_FILM_PASSTHROUGH_FIELDS` — bez zmian backendu na `.35`.

## SoulX Port Moved to 7002 (2026-04-19)

- Port SoulX na `.13` został przeniesiony z `:7000` na `:7002` (operacja po stronie `.13`).
- `.env.local` zaktualizowane: `SOULX_BASE_URL=http://192.168.0.13:7002`.
- Preflight probe dalej działa (probe sekwencja: `/health` → `/openapi.json` → `/`).
- **Latent bug — nie fixed:** `probeSoulXReadiness` przy throw (timeout) nie przechodzi do kolejnego kandydata w liście — zwraca od razu failure. Przy 7002 działa, ale gdyby któraś pierwsza próba rzuciła → cała lista ubita. Do refactora jeśli będą fałszywe negatywy.

## Title Burn-in — Auto-Wrap + Green (2026-04-19)

- **Kolor tytułu na thumbnailu zmieniony z białego na zielony `#00FF04`** (matchuje word-highlight caption color).
- **Auto-wrap długich tytułów** — nowy helper `wrapTitleText(raw, maxCharsPerLine)` w `podcast-film/jobs/route.ts`:
  - Dzieli po słowach, agreguje do linii ≤ 28 znaków.
  - Zachowuje explicit `\n` z inputu.
  - Zapisany do `title.txt` (czytany przez ffmpeg `drawtext textfile=`).
- Pozycja tytułu obniżona: `y=1512-text_h/2` (było `y=1480` dla pojedynczej linii; teraz centrowane wertykalnie wokół `y=1512`, żeby 2-3 linie nie wychodziły poza dolny pasek).
- Czas wyświetlania niezmieniony (`CAPTION_START_DELAY_SECONDS=0.12s`, frame 0).

## Polish Podcast Prompt — Evolution & Final (2026-04-19)

**Kontekst:** użytkownik chciał dialogi w gwarze śląskiej (Antoni) + góralskiej (Zofia) z charakterem "zabawne, pełne gagów przedstawienie wiadomości AI z punktu widzenia normalnych ludzi". Przez cały 2026-04-19 iterowałem prompt i testowałem 6 modeli; wyniki zachowane w `prompt-tests/`.

### Iteracje promptu
1. **v0** (początkowy) — słaba gwara, brak humoru, długie tyrady. Baseline 3.0/10.
2. **v1-v5** — dodany dialekt jako hard constraint, personalities energetic/sarcastic. Podniesienie do 5.7/10 na Gemini 3 Flash.
3. **v6 "Rogan-style"** — TOP PRIORITY header, MAX 160 zn, 10-14 wymian, przykład z Biedronką/ZUS/teściową. Snappier dialog, ale daily-life elements dalej **0 na 27 kwestii** nawet na Opus 4.7.
4. **v7 "bez codzienności"** — usunięty `CODZIENNY ELEMENT — TWARDY WYMÓG` i przykład przepisany bez Biedronki. Dialogi naturalniejsze, bez forsowania.
5. **v8 FINAL (aktywny)** — `MAX 220 zn` (było 160), `MAX 2-3 zdania`, `DOKŁADNIE 10 wymian`, `Łącznie 1600-2200 zn = 1.5-2.5 min`.

### Model shootout (prompt v6, 1 próbka/model)
| Model | Avg score | Koszt vs Flash | Uwagi |
|---|---:|---:|---|
| anthropic/claude-opus-4.7 | 6.7 | 10x | najmocniejsza gwara Zofii, najlepsza dyscyplina długości |
| google/gemini-3.1-pro-preview | 6.3 | 5x | najmocniejsze osobowości, łamie limity długości |
| google/gemini-2.5-flash | 5.3 | 1x | przyzwoity średniak |
| deepseek/deepseek-v3.2 | 5.2 | ? | najkrótszy, punchy |
| google/gemini-3.1-flash-lite-preview | 4.0 | 0.5x | za słaby na twardy prompt |
| minimax/minimax-m2.7 | 3.5 | ? | łamie limity, gubi polskie znaki — NIE używać |

### Test 3×3 (prompt v7, 3 podcasty per model)
| Model | Avg zn | Czas | W targecie 1.5-2.5 min | Over 220 zn |
|---|---:|---:|---|---:|
| anthropic/claude-opus-4.7 | 121 | 1:13 | **0/3** ❌ za krótkie | 0 ✅ |
| google/gemini-3.1-pro-preview | 233 | 2:05 | **3/3** ✅ | 8/8 ❌ |
| google/gemini-2.5-flash | 161 | 1:29 | 1/3 ⚠️ | 4/8 |

### Test FINAL (prompt v8, Gemini 3.1 Pro, 3 podcasty)
| Run | # wymian | Avg zn | Max | Czas | W targecie | Over 220 |
|---:|---:|---:|---:|---:|---|---:|
| 1 | 8 | 173 | 188 | 1:32 | ✅ | 0 ✅ |
| 2 | 8 | 207 | 214 | 1:50 | ✅ | 0 ✅ |
| 3 | 8 | 185 | 209 | 1:38 | ✅ | 0 ✅ |

**Ostateczna konfiguracja (produkcja):**
- `OPENROUTER_MODEL=google/gemini-3.1-pro-preview`
- Prompt v8 `defaultHostPersonalitiesPolish` w `generate-podcast/route.ts` — 220 zn / 10 wymian / 1.5-2.5 min target
- Brak wymogu codziennych elementów (Biedronka/ZUS/teściowa) — sprawdziło się, że żaden model tego i tak nie generuje pod ciśnieniem tech-contentu
- Koszt vs Opus: ~50% taniej przy identycznej/lepszej jakości dla tego formatu

### Znane ograniczenia modeli
- **Gemini 3.1 Pro upiera się przy 8 wymianach**, niezależnie od instrukcji "dokładnie 10". Nie blocker — 8 wymian daje 1.5-1.8 min, mieści się w targecie.
- **Opus 4.7 upiera się przy 9 wymianach** i krótszych kwestiach — nie dowozi targetu 1.5-2.5 min (daje ~1:13).
- Daily-life elements (Biedronka/PKP/ZUS/teściowa) są semantycznie dominowane przez content (AI/benchmarki/giełda). Żaden model ich nie wstrzykuje pod presją wyłącznie promptu. Wymagałoby content-rewriting pre-pass albo retry-until-happy — nie warte kosztu w tym kontekście.

## Interrupted Job Handling — Known Gap (2026-04-19)

- Incident 2026-04-19: restart `aipodcast` podczas aktywnego joba `pbfilm_0795c49385db4e019721a5a85000ffd3` (~71% w `whisper_align`) zostawił `state: running` na zawsze.
- Ręcznie przepisany `status.json` na `state: failed, code: "service_restart"`.
- **Rule:** przed `systemctl restart aipodcast` sprawdź aktywne joby w `/root/AiPodcast/archive/podcast-video/*/status.json` (`state: running`).
- Dokumentowane ryzyko z `Progress Tracking / Ryzyka` — akceptowane na start, brak demona sprawdzającego pozostaje.

## What Is Still Open

### 1. Caption alignment quality (deferred)

- Visual QA on 2026-04-18 confirmed the current greedy window=3 aligner is "good enough" in live output.
- Keep this open only if future smokes show `caption_unmatched_words` spiking or visible timing drift.
- Candidate upgrade if revisited: fuzzy match (Levenshtein) + wider window + DP alignment instead of greedy.

### 2. Verification

- Verified on `.54` on 2026-04-18:
  - `.54 -> .13:8766` health + live job path
  - `.54 -> .13:7000` health + live job path
  - final MP4 + SRT URLs are fetched correctly by the client
  - full raw-text smoke with burned captions enabled
- ✅ Verified `.35 -> .54` proxy-contract `.54` end on 2026-04-18 (after gender-mapping + TTS-guard changes):
  - `POST /api/podcast-video/podcast-film/jobs` without key → 401; wrong key → 401.
  - Key + empty body → 400 `"No segments produced from conversation[], speaker-marked transcript, or raw-text generation."`
  - Matrix-shaped Pipeline B payload (`title`, `language`, `transcript`, `tts_engine`, `voice1/voice2`, `soulx_model`, `use_face_crop`, `transition`, `dryRun`) → 200 with `success=true`, `segments_count=8`, `voices_swapped_for_gender=true`.
  - Network hop `.35 -> .54:3300` already verified earlier today (see `.35 Proxy Path` section above); recent changes touch neither URL, auth header, nor request schema — only add optional response fields — so the network verification is still valid.
- ✅ Verified existing Static Video / Pipeline A flow still behaves unchanged on `.54` 2026-04-18:
  - `POST /api/podcast-video/jobs` (no key) → 401
  - `POST /api/podcast-video/jobs` (key + empty body) → 400 `"Request must include script_text, conversation, or transcript."`
  - `POST /api/generate-podcast` without `ttsEngine` field still emits `[ekscytacja]`, `[wzdycha]`, `[sarkastycznie]` and em-dash interruptions (`—Słuchać...`) — backward compatibility for the ElevenLabs path preserved.
- Run the same raw-text smoke through the real Matrix / `.35` product path, not only by direct local POST on `.54`.

## Build / Scrape Note — Verified on 2026-04-18

- Build warning from `@mendable/firecrawl-js` was caused by missing `undici` dependency in the app runtime.
- `.54` now has `undici` installed, `next build` completes without the previous `Can't resolve 'undici'` warning, and `/api/scrape` returns `200 OK` on a simple smoke (`https://example.com`).
- This is not a Pipeline B blocker, but it matters for clean production builds on `.54`.

## Where To Run Next Steps

- **Najlepsza maszyna do dalszych testów backendowych: `.54` (`Podcast` / `AiPodcast`)**
  - tu są route, `.env.local`, logi, archiwum jobów i smoke scripty
  - to jest najtańsze miejsce do iteracji nad Workflow B
- **`.35` używaj tylko do testu prawdziwej ścieżki produktowej Matrix -> proxy -> `.54`**
  - nie debuguj tam codziennie backendu, bo każdy pełny retry z raw text może znów odpalić `/api/generate-podcast` i spalić tokeny
- **`.13` używaj tylko do workerów**
  - OmniVoice `:8766` health / restart / logi
  - SoulX `:7000` health / restart / logi
  - nie testuj tam orkiestracji AiPodcast

## Environment Note (2026-04-18)

- Access ports changed on `.13`:
  - OmniVoice podcast-film worker remains on `:8766`
  - OmniVoice `:7001` is not the old podcast-film REST worker contract
  - SoulX now uses `:7000`
- `.54` should use `OMNIVOICE_BASE_URL=http://192.168.0.13:8766` and `SOULX_BASE_URL=http://192.168.0.13:7000`.

## Cheapest Test Order

- 1. Na `.54`: `dryRun` z raw text, gdy zmieniasz etap generowania podcastu lub segmentacji.
- 2. Na `.54`: speaker-marked `dryRun`, gdy debugujesz tylko downstream i nie chcesz odpalać generatora rozmowy.
- 3. Na `.54`: pełny smoke z raw text dopiero wtedy, gdy poprzednie dwa kroki są zielone.
- 4. Na `.35`: pojedynczy smoke produktowy dopiero po stabilizacji `.54`.

## Voice Selector — Backend Ready on `.54` (2026-04-18)

- New endpoint `GET /api/podcast-video/podcast-film/voices` on `.54:3300`.
  - Auth: same `x-api-key` (`APP_API_KEY`) as podcast-film jobs.
  - Proxies `http://192.168.0.13:8766/voices` with 5 min in-memory cache (survives hot reload via `globalThis`).
  - `?refresh=1` forces cache bypass.
  - Response: `{ source, fetched_at, count, voices[], by_gender: { female[], male[], other[] } }` — each voice includes `id`, `label`, `gender`, `language`, `aliases`, `default_image_folder`.
  - Verified 2026-04-18: 401 without key; 200 with key returns 9 voices (3F + 6M); second call ~15ms (cache hit).
- ✅ Matrix backend forwarder wired on `.35` 2026-04-18:
  - `GET /api/podcast-video/podcast-film/voices` in `/opt/SocialMedia/backend/app/api/routers/tasks.py` (around line 1013).
  - Uses same `get_auth_context` Bearer auth as other task routes; forwards with `x-api-key` from `PODCAST_API_KEY` to `.54/api/podcast-video/podcast-film/voices`.
  - Derives voices URL from `_podcast_film_video_url()` so it follows `PODCAST_FILM_VIDEO_API_URL` automatically.
  - Accepts `?refresh=1` passthrough to force upstream cache bypass.
  - Verified: 401 without Bearer, 401 with bogus Bearer, route listed in OpenAPI `/openapi.json`.
- ✅ Frontend dropdowns wired in `/opt/SocialMedia/frontend/src/components/App/PhaseDetails/Phase04_Social.tsx` on 2026-04-18:
  - Added `PODCAST_FILM_VOICES_API` constant + `OmniVoice` type.
  - `useEffect` fetches `/api/podcast-video/podcast-film/voices` on mount, picks a sensible default (first male for Voice A, first female for Voice B), stores selection in scoped persistent state (`phase04_podcast_voice1` / `phase04_podcast_voice2`).
  - Two `<select>` elements with `<optgroup label="Male|Female">` rendered only when voices load (fallback: if fetch fails, dropdowns stay hidden and payload omits `voice1`/`voice2`, so `.54` falls back to `host_a`/`host_b` aliases — unchanged behaviour).
  - Pipeline B payload for `kind === "podcast"` conditionally spreads `voice1` / `voice2` when selected — non-breaking for existing flow.
  - Tsc passed clean on this file; Vite HMR picked up the change automatically.
  - Pass selected IDs as `voice1` / `voice2` in the Pipeline B payload (names already passthrough — no backend changes on `.54` needed).
  - `voice-catalog.json` on `.54` can be deprecated once the UI reads the live endpoint.
- Single full Matrix e2e smoke should be run only after the UI is wired (one shot — burns tokens).

## Progress Tracking — Option B (Job ID + Polling) — In Progress (2026-04-18)

**Why:** Ostatni pełny Matrix e2e wrócił na kartę startową bez podglądu. `.35` dostał 502 po dokładnie 5 min — fetch z `.54/api/podcast-video/podcast-film/jobs:1127` do OmniVoice `/api/v1/podcast-film/jobs` trzasł na undici default `bodyTimeout=300000ms`. OmniVoice TTS dla dłuższych skryptów może mielić >5 min; synchroniczny POST bez timeoutu i bez postępu nie ma szans przeżyć.

**Cel:** POST `/jobs` zwraca natychmiast `{job_id}`, pipeline leci w tle, frontend pytuje `GET /jobs/{id}/status` co 2s i pokazuje pasek z etykietą fazy. Stan trzymany w `archive/podcast-video/{jobId}/status.json` (atomowy rename, bez DB).

### Faza 1 — `src/lib/podcast-video/job-status.ts` ✅ (2026-04-18)

- Nowy lib z typami `JobPhaseId`, `JobState`, `JobStatus` i helperami:
  - `JOB_PHASES` (7 faz: `generate_podcast`, `fetch_voices_images`, `omnivoice_tts`, `soulx_talkhead`, `concat`, `whisper_align`, `burn_subs`)
  - `initStatus(jobId)` — tworzy katalog joba przez `ensurePodcastVideoArchiveDir` i zapisuje `status.json` w stanie `queued`.
  - `readStatus(jobId)` — zwraca `JobStatus | null`; jedna retry na wypadek trafienia w moment `rename`.
  - `updateStatus(jobId, patch)` — merge poprzedniego JSON + nowego patcha, atomowy zapis (`tmp-<pid>-<ts>` + `rename`).
  - `setPhase(jobId, phase, message, phaseProgress?)` — wylicza `percent` z `phase_index/phase_total` + bump z `phaseProgress.current/total` (cap 99%), ustawia `state: 'running'`.
  - `markDone(jobId, result)` — `state: 'done'`, `percent: 100`, `result` = pełny payload (to co dziś zwraca POST).
  - `markFailed(jobId, detail, phase, code?)` — `state: 'failed'`, `error: { phase, code, detail }`.
- `tsc --noEmit -p tsconfig.json` czysto dla nowego pliku.

### Faza 2 — Refactor `podcast-film/jobs/route.ts` POST na async ✅ (2026-04-18)

- POST tworzy `job_id`, zapisuje `status.json` przez `initStatus(jobId)` i zwraca `202 { job_id, status_url }` bez czekania na `fetchVoiceRegistry()` ani na raw-text `generateSegmentsFromRawText(...)`.
- Ciężka ścieżka została przeniesiona do `runBackgroundPipeline(jobId, config, publicBaseUrl)`.
- Nowy helper `preparePipelineInput(...)` spina:
  - voice registry fetch
  - gender-aware `male_voice` / `female_voice` mapping
  - `conversation[]` / speaker-marked transcript / raw-text generation fallback
  - końcowe `stripTtsInlineTags()` + walidację pustych segmentów
- `generate_podcast` jest teraz realną fazą statusu (wcześniej była tylko w modelu status.json, ale nie była ustawiana).
- `dry_run` pozostał synchroniczny i dalej zwraca `segments_preview`.
- Lekka walidacja wejścia została zachowana przed kickoffem:
  - pusty body bez `conversation` i bez `transcript` dalej zwraca `400`
  - nieobsługiwany `tts_engine` dalej zwraca `501`
- Dodany jawny `AbortSignal.timeout(15 * 60 * 1000)` na fetch do OmniVoice `/api/v1/podcast-film/jobs` (naprawa root cause 502).
- Background catch nie zwraca już błędu do klienta; zamiast tego zapisuje `state: failed` przez `markFailed(...)`.

### Faza 3 — `GET /api/podcast-video/podcast-film/jobs/[jobId]/status` ✅ (2026-04-18)

- Dodany route: `src/app/api/podcast-video/podcast-film/jobs/[jobId]/status/route.ts`.
- Auth przez `isPodcastVideoAuthorized`, `Cache-Control: no-store`.
- Czyta `status.json` przez `readStatus(jobId)`.
- `404` gdy brak statusu, `200` z pełnym `JobStatus` gdy job istnieje.

### Verification Note — Local Session (2026-04-18)

- Targeted typecheck dla plików opcji B jest czysty:
  - `src/app/api/podcast-video/podcast-film/jobs/route.ts`
  - `src/app/api/podcast-video/podcast-film/jobs/[jobId]/status/route.ts`
  - `src/lib/podcast-video/job-status.ts`
- Pełny `bash /root/.agents/skills/check/scripts/verify.sh` nadal pada na niepowiązanych, wcześniejszych błędach repo:
  - `src/app/api/podcast-video/jobs/route.ts`
  - `src/app/api/voices/route.ts`
  - `src/app/api/webhook/test-minio/route.ts`

### Regression Fixes — Follow-up After Live Smoke ✅ (2026-04-18)

- `.54` `src/app/api/podcast-video/podcast-film/jobs/route.ts`:
  - root cause live runu `pbfilm_a6195eca9d1f4abc88b61d08c1e8b616` był nadal timeout po ~`300.649s` w `omnivoice_tts`, mimo `AbortSignal.timeout(15min)`.
  - fix: przełączenie OmniVoice POST z globalnego `fetch` na `undiciFetch(..., { dispatcher: new Agent({ headersTimeout, bodyTimeout, connectTimeout }) })`, żeby zdjąć realny 5-min limit na oczekiwanie nagłówków/body.
  - `describeError(...)` rozszerzony o `code`, `errno`, `cause`, żeby kolejny fail nie kończył się samym gołym `fetch failed`.
- `.35` `Phase04_Social.tsx`:
  - fix: przy starcie podcast-film generation `setMp4Url(null)` czyści stary preview, więc karta nie udaje sukcesu na bazie poprzedniego statycznego MP4.
  - fix: panel progressu / panel błędu został wyciągnięty poza gałąź `!mp4Url`, więc status i błąd są widoczne także wtedy, gdy karta miała wcześniej stary player.
  - fix: przy `state: failed` frontend czyści lokalny `mp4Url`, więc nie zostawia użytkownika z mylącym, starym wideo po nieudanym runie.
- Weryfikacja:
  - `npm run build` na `.54` po tych zmianach ✅
  - `systemctl restart aipodcast` i nowy start serwisu o `2026-04-18 19:24:23 UTC` ✅
  - `cd /opt/SocialMedia/frontend && npx tsc --noEmit` na `.35` ✅

### Worker Preflight — Fail Fast Before Job Kickoff ✅ (2026-04-18)

- `src/app/api/podcast-video/podcast-film/jobs/route.ts` ma teraz synchroniczny preflight przed `202` / `job_id`.
- Checki:
  - OmniVoice: `GET /health` musi odpowiedzieć z `ok=true`, potem `GET /voices` musi zwrócić niepustą listę głosów.
  - SoulX: szybki probe `GET /health`, z fallbackiem do `GET /openapi.json` i `GET /`.
- Timeout preflightu: `2500ms`, osobny `undici` dispatcher (`WORKER_PROBE_DISPATCHER`), więc nie czekamy minutami na martwy host.
- Gdy którykolwiek worker nie odpowiada:
  - POST `/api/podcast-video/podcast-film/jobs` zwraca od razu `503`
  - body zawiera:
    - `error: "Podcast-film worker preflight failed."`
    - `detail` z rozbiciem na `omnivoice` / `soulx`
    - `checks[]` z per-service diagnostyką
  - job **nie** jest tworzony, nie ma `status.json`, nie odpalamy `/api/generate-podcast`, nie przepalamy tokenów na LLM.
- Weryfikacja przy ręcznie wyłączonych workerach `.13`:
  - local POST na `.54` zwrócił `503` w `~2.54s`
  - detail:
    - `omnivoice: health request failed: ... timeout`
    - `soulx: probe failed: ... timeout`
- `.35` backend proxy (`tasks.py`) przestał obcinać szczegóły błędu z `.54`:
  - teraz skleja `error + detail`, więc Matrix dostaje nie tylko `Podcast-film worker preflight failed.`, ale też konkretny powód (`omnivoice timeout`, `soulx timeout`, itp.).

### Faza 4 — Proxy na `.35` ✅ (2026-04-18)

- Dodany endpoint `GET /api/podcast-video/podcast-film/jobs/{job_id}/status` w `/opt/SocialMedia/backend/app/api/routers/tasks.py`.
- Auth: ten sam `get_auth_context` Bearer flow co reszta routera.
- Upstream call: `.35 -> .54/api/podcast-video/podcast-film/jobs/{job_id}/status` z `x-api-key`.
- Timeouty pollingowe ustawione krótko: `connect=5s`, `read=8s`, `write=8s`.
- Dodatkowo `.35` route przy `state: done` potrafi zapisać `result.mp4_url` do DB, jeśli frontend poda `task_id` i `language` w query params.
- Weryfikacja 2026-04-18:
  - `python3 -m py_compile /opt/SocialMedia/backend/app/api/routers/tasks.py` ✅
  - `systemctl restart socialmedia-backend` ✅
  - route widoczny w `http://127.0.0.1:7888/openapi.json` jako `/api/podcast-video/podcast-film/jobs/{job_id}/status` ✅

### Faza 5 — Matrix UI w `Phase04_Social.tsx` na `.35` ✅ (2026-04-18)

- Dodane trwałe stany:
  - `phase04_podcast_film_job_id`
  - `phase04_podcast_film_task_id`
  - `phase04_podcast_film_language`
- `useEffect` polluje `/api/podcast-video/podcast-film/jobs/{id}/status` z backoffem `2s -> 3s -> 5s`.
- `state: done`:
  - ustawia lokalne `mp4_url`
  - czyści `job_id`
  - wywołuje `fetchLatestWebhook()` żeby odświeżyć dane po persystencji backendowej
- `state: failed`:
  - pokazuje czerwony komunikat z nazwą fazy + detalem
  - nie resetuje użytkownika do startowej karty
- UI pokazuje pasek postępu z procentem i etykietą fazy po PL.
- Frontend blokuje równoległe odpalenie kolejnego podcast-film joba, jeśli poprzedni jeszcze polluje.
- Weryfikacja 2026-04-18:
  - `cd /opt/SocialMedia/frontend && npx tsc --noEmit` ✅
  - frontend działa pod `socialmedia-frontend.service` jako `npm run dev`, więc zmiana została podana bez osobnego restartu.

### Faza 6 — E2E Matrix + aktualizacja TODO + memory 🔜

### Ryzyka

- Crash procesu `aipodcast` w trakcie joba zostawi `state: running` na zawsze (brak demona sprawdzającego). Akceptowane na start. Sprzątanie może dojść później.
- Polling współbije z atomowym `rename` — mitigacja: `readStatus` ma jedną retry, `atomicWrite` używa unikalnego `tmp-<pid>-<ts>`.

## Later

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
