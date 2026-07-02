# Progress Log

## Session: 2026-04-22

### Phase 1: Discovery and architecture alignment
- **Status:** complete
- **Started:** 2026-04-22 00:00 UTC
- Actions taken:
  - Zweryfikowano kierunek architektury `raw_text | conversation`, OpenRouter-only dla LLM i direct TTS.
  - Rozpoznano obecne punkty integracji dla Gemini TTS, generate-podcast, workflow A/B i UI.
  - Zdiagnozowano wcześniejsze problemy deploy/frontendu i doprowadzono `/podcast-video` do działania.
- Files created/modified:
  - wiele plików backend/UI w refaktorze wcześniejszych etapów

### Phase 2: Unified video UX and archive
- **Status:** complete
- Actions taken:
  - Dodano historię MP4, preview ostatniego filmu i usuwanie starych renderów.
  - Uporządkowano `/podcast-video` jako krokowy wizard.
- Files created/modified:
  - `src/app/podcast-video/page.tsx`
  - `src/app/api/podcast-video/jobs/route.ts`
  - `src/app/api/podcast-video/jobs/[jobId]/route.ts`
  - `src/lib/podcast-video/history.ts`

### Phase 3: Gemini expressiveness and tempo
- **Status:** complete
- Actions taken:
  - Dodano `geminiStyle` i `geminiTempo` do typów i kontraktów.
  - Przepisano prompt Gemini TTS na reżyserski, z sanitacją do lekkiego whitelistu cue tags.
  - Zmieniono `generate-podcast`, żeby Gemini mogło generować `expressive-lite` zamiast plain text.
  - Przepięto workflow A/B i oba ekrany UI.
  - Wygenerowano 4 dialog-only WAV testy przez live `/api/text-to-speech`.
- Files created/modified:
  - `src/lib/podcast/contracts.ts`
  - `src/types/index.ts`
  - `src/lib/podcast-video/types.ts`
  - `src/actions/gemini-tts.ts`
  - `src/app/api/text-to-speech/route.ts`
  - `src/lib/podcast/generate.ts`
  - `src/app/api/generate-podcast/route.ts`
  - `src/lib/podcast-video/orchestrator.ts`
  - `src/app/api/podcast-video/podcast-film/jobs/route.ts`
  - `src/app/page.tsx`
  - `src/app/podcast-video/page.tsx`

### Phase 4: Default selection
- **Status:** complete
- Actions taken:
  - Na podstawie odsłuchu użytkownika i matrycy testowej wybrano `expressive-lite + fast`.
  - Kod został zmieniony tak, aby `fast` było domyślnym tempem Gemini.
  - Przygotowano handoff pliki i prompt do kolejnej sesji.
  - Wykonano build, restart `aipodcast.service` i live dry-run probe bez jawnych pól Gemini.
  - Potwierdzono, że prompt domyślnie używa `expressive-lite + fast`.
- Files created/modified:
  - `src/lib/podcast/contracts.ts`
  - `src/actions/gemini-tts.ts`
  - `src/app/page.tsx`
  - `src/app/podcast-video/page.tsx`
  - `src/app/api/podcast-video/podcast-film/jobs/route.ts`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `next_session_prompt.md`

### Phase 6: Live full-MP4 QA and Gemini fixes
- **Status:** in_progress
- Actions taken:
  - Potwierdzono live default Gemini przez dry-run `/api/text-to-speech` bez jawnych pól Gemini.
  - Wykryto, że `/api/podcast-video/jobs` nie czytało `tts.geminiStyle/geminiTempo` z payloadu UI.
  - Wykryto błąd shared normalizera, przez który `geminiTempo=normal` było mapowane na `fast`.
  - Odtworzono realny błąd `conversation -> workflow B -> gemini`: single-segment Gemini TTS zwracał `500 INTERNAL`.
  - Naprawiono `createGeminiDialogue()` tak, aby single-speaker Gemini działał przez dwu-voice config, co odblokowało workflow B.
  - Wykonano pełny render `raw_text -> workflow A -> gemini` i pełny render `conversation -> workflow B -> gemini` na live serwisie.
  - Zaktualizowano `PUBLIC_API.md` i `docs/podcast-video-flow.md`, aby zapisać obecny live default Gemini jako `expressive-lite + fast`.
- Files created/modified:
  - `src/app/api/podcast-video/jobs/route.ts`
  - `src/lib/podcast/contracts.ts`
  - `src/actions/gemini-tts.ts`
  - `PUBLIC_API.md`
  - `docs/podcast-video-flow.md`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `next_session_prompt.md`

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Typecheck after Gemini changes | `npx tsc --noEmit` | Clean types | Passed after rebuilding `.next/types` | ✓ |
| Production build after Gemini changes | `npm run build` | Successful build | Passed | ✓ |
| Dialogue-only Gemini matrix | 4 variants | Public WAV URLs | 4 WAVs archived successfully | ✓ |
| `expressive-lite + normal` duration | archived WAV | Around prior baseline | `75.44s` | ✓ |
| `expressive-lite + fast` duration | archived WAV | Shorter than normal | `70.24s` | ✓ |
| `plain + normal` duration | archived WAV | Comparable neutral variant | `75.04s` | ✓ |
| `plain + fast` duration | archived WAV | Shortest/neutral fast variant | `68.84s` | ✓ |
| Live default Gemini probe | `/api/text-to-speech` dryRun without explicit Gemini fields | Prompt should imply `expressive-lite + fast` | Confirmed in debug prompt | ✓ |
| Workflow A dry run preserves explicit Gemini fields | `/api/podcast-video/jobs` with `geminiStyle=plain`, `geminiTempo=normal` | Normalized request should keep both fields | Passed after route + normalizer fix | ✓ |
| Workflow A full MP4 render | `raw_text -> /api/podcast-video/jobs?wait=1&return=mp4_url` | Successful full MP4 with Gemini defaults | Passed, job `podcast_video_1776888816953_im7ndt`, MP4 ~`105.00s` | ✓ |
| Single-segment Gemini repro | `/api/text-to-speech` with one conversation item | Should no longer fail with Gemini 500 | Passed after `createGeminiDialogue()` fix | ✓ |
| Workflow B full MP4 render | `conversation -> /api/podcast-video/podcast-film/jobs` | Successful full MP4 with Gemini | Passed, job `pbfilm_21e9e294b0524b32a27952cc2486537b` | ✓ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-04-22 18:33 UTC | `TS6053` for missing `.next/types/*` | 1 | Ran `npm run build`, then reran `tsc` |
| 2026-04-22 18:35 UTC | `Property 'geminiStyle' does not exist` in `preparePipelineInput` | 1 | Extended picked `PipelineConfig` type |
| 2026-04-22 19:35 UTC | Workflow A dry-run response omitted `geminiStyle/geminiTempo` | 1 | Added those fields to `normalizeIncomingRequest()` in `/api/podcast-video/jobs` |
| 2026-04-22 19:42 UTC | `geminiTempo=normal` normalized back to `fast` | 1 | Fixed `normalizeGeminiTempo()` in `src/lib/podcast/contracts.ts` |
| 2026-04-22 20:12 UTC | Workflow B Gemini jobs failed with `500 INTERNAL` in per-segment TTS | 2 | Reproduced via one-segment `/api/text-to-speech`, then fixed single-speaker Gemini in `src/actions/gemini-tts.ts` |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Phase 6: live full-MP4 QA after Gemini bug fixes |
| Where am I going? | Human listening pass of the generated full MP4 artifacts in Polish |
| What's the goal? | Production-safe Gemini expressive defaults for Polish podcast/video |
| What have I learned? | Live default is still `expressive-lite + fast`, but the final subjective MP4 listening pass is still pending |
| What have I done? | Fixed workflow A Gemini pass-through, fixed shared tempo normalization, fixed workflow B single-segment Gemini, and rendered both target MP4 flows successfully |

## Session: 2026-05-06

### Phase 7: Superpowers cleanup and documentation
- **Status:** in_progress
- Actions taken:
  - Uruchomiono audyt dirty worktree i odczytano istniejące pliki planu.
  - Zidentyfikowano, że `public/podcast-page-preview.html` jest statycznym prototypem zastąpionym przez zakładkę React w `/podcast-video`.
  - Zapisano decyzję, żeby nie usuwać aktywnych endpointów ani smoke scripts bez twardego dowodu martwego kodu.
  - Usunięto niepodpięte jednorazowe skrypty: `scripts/final-delivery.js`, `scripts/final-fix.js`, `scripts/parser-shim-v2.js`, `scripts/verify-fixes.js`, `scripts/test-sync.js`, `test-settings.js`.
  - Usunięto pusty `scripts/test-minimal.ts`.
  - Przeniesiono hard-cut smoke z CommonJS do `scripts/test-podcast-film-hard-cut.mjs`.
  - Usunięto drobny martwy kod/unused z `podcast-film/jobs/route.ts`, `podcast-video/jobs.ts` i `transcript-parser.ts`.
  - Dotypowano lokalnie legacy `any` w parserze transkryptu, MinIO/NCA helperach, webhookach, auth guardzie, audio splitterze i wybranych smoke scripts.
  - Usunięto hardcoded fallback credentials z `src/app/api/webhook/test-minio/route.ts` i `src/app/api/v1/generate/route.ts`.
  - Przepisano `TODO.md` z historycznego dziennika na krótką bieżącą listę prac.
  - Zaktualizowano `docs/podcast-video-flow.md`, `PUBLIC_API.md` i `next_session_prompt.md` o stałą zakładkę `Podgląd stylu` oraz obecny preset.
  - Dodano `/test-output` do `.gitignore`, żeby lokalne artefakty testowe nie zaśmiecały statusu.
- Files created/modified:
  - `.gitignore`
  - `TODO.md`
  - `PUBLIC_API.md`
  - `docs/podcast-video-flow.md`
  - `next_session_prompt.md`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `scripts/test-podcast-film-hard-cut.mjs`
  - `src/app/api/podcast-video/podcast-film/jobs/route.ts`
  - `src/app/api/generate-podcast/route.ts`
  - `src/app/api/podcast-video/jobs/[jobId]/file/route.ts`
  - `src/app/api/v1/generate/route.ts`
  - `src/app/api/webhook/approve/route.ts`
  - `src/app/api/webhook/process/route.ts`
  - `src/app/api/webhook/test-minio/route.ts`
  - `src/actions/dialogue.ts`
  - `src/components/auth/AuthGuard.tsx`
  - `src/app/page.tsx`
  - `src/lib/podcast-video/audio-splitter.ts`
  - `src/lib/podcast-video/jobs.ts`
  - `src/lib/podcast-video/minio.ts`
  - `src/lib/podcast-video/nca.ts`
  - `src/lib/transcript-parser.ts`
  - `scripts/test-real-audio-job.ts`
  - `scripts/test-real-material.ts`
  - `scripts/test-text-generation.ts`
  - `scripts/verify-duration.ts`
  - deleted: `scripts/final-delivery.js`
  - deleted: `scripts/final-fix.js`
  - deleted: `scripts/parser-shim-v2.js`
  - deleted: `scripts/verify-fixes.js`
  - deleted: `scripts/test-sync.js`
  - deleted: `scripts/test-minimal.ts`
  - deleted: `scripts/test-podcast-film-hard-cut.js`
  - deleted: `test-settings.js`

### Verification 2026-05-06
- `npm run build` passed.
- `npx tsc --noEmit` passed.
- `npm run lint` passed with exit code 0 and 2 warnings:
  - `src/app/page.tsx`: existing auto-download hook dependency warning.
  - `src/app/podcast-video/page.tsx`: existing `@next/next/no-img-element` warning.
- `git diff --check` passed.

### Phase 8: First-frame title burn-in QA
- **Status:** complete
- Actions taken:
  - W rendererze `podcast-film` najpierw odtworzono problem przebijania tła pod tytułem pierwszej klatki.
  - Usunięto ciężką czarną podkładkę, bo nie odpowiadała stylowi z podglądu.
  - Realny tytuł pierwszej klatki używa teraz zieleni, obrysu, rozmiaru, marginesu i przesunięcia Y zgodnych z zapisanym `cover_style`.
  - Generator wysyła zapisane ustawienia covera z `localStorage` w payloadzie workflow B.
  - Przyciemnienie pola zdjęcia zostało zachowane tylko jako lekka warstwa, bez lokalnego panelu za tytułem.
  - Odświeżono publiczny proof: `https://podcast.aihub.ovh/podcast-first-frame-check.jpg`.
  - Po buildzie zrestartowano `aipodcast.service`.
- Files created/modified:
  - `src/app/api/podcast-video/podcast-film/jobs/route.ts`
  - `src/app/podcast-video/page.tsx`
  - `src/components/podcast-video/PodcastStylePreview.tsx`
  - `public/podcast-first-frame-check.jpg`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
- Verification:
  - `npx tsc --noEmit` passed.
  - `npm run lint` passed with exit code 0 and 2 existing warnings.
  - `git diff --check` passed.
  - `npm run build` passed.
  - `systemctl is-active aipodcast` returned `active`.
  - `curl -I https://podcast.aihub.ovh/podcast-first-frame-check.jpg` returned `HTTP/2 200`.
  - Playwright loaded `https://podcast.aihub.ovh/podcast-video` with HTTP `200` and no `pageerror`/failed requests.
  - Local `podcast-film` dry-run with same-origin `referer` returned HTTP `200`, `success=true`, `pipeline=podcast-film-v1`, `segments_count=2`.
  - Local `podcast-film` dry-run with `cover_style` returned the same first-frame style values: `titleSize=43`, `titleMarginX=18`, `titleOffsetY=0`, `titleColor=#25FF00`, `titleOutlineColor=#050608`.
