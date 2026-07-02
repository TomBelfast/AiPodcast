# Findings & Decisions

## Requirements
- Publicznie wspierane wejścia mają pozostać dwa: `raw_text` i `conversation`.
- LLM ma iść wyłącznie przez OpenRouter.
- TTS ma iść direct przez `gemini`, `elevenlabs`, `omnivoice`.
- Workflow A i B mają zostać, ale z ustandaryzowanym kontraktem providerów.
- Gemini ma pozostać na `gemini-3.1-flash-tts-preview`.
- Użytkownik chciał wyższą energię, śmiech/westchnienia i lepszą ekspresję dla polskiego.

## Research Findings
- W naszej integracji Gemini TTS nie używa osobnego numeric speed parametru; sterowanie tempem i stylem odbywa się promptem.
- Dokumentacja Gemini/Cloud TTS wspiera natural-language direction i lekkie cue tags.
- Z szerokiego starego zestawu adnotacji najbardziej przewidywalne dla Gemini są: `[laughing]`, `[sigh]`, `[uhm]`, `[short pause]`.
- `raw_text -> generate-podcast` miało wcześniej specjalne plain-speech guardy dla Gemini; to trzeba było odwrócić bez ruszania OmniVoice.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Dodać `geminiStyle` i `geminiTempo` do kontraktów requestów | Jeden wspólny przepływ przez API, workflow A/B i UI |
| `geminiStyle` domyślnie `expressive-lite` | Użytkownik odsłuchowo wolał wariant z lekkimi tagami |
| `geminiTempo` domyślnie `fast` | Po dodatkowych testach użytkownik wybrał `lite fast` jako finalny default |
| Sanityzować bracketed cues w `createGeminiDialogue()` | Nie pozwalać na stare niekontrolowane adnotacje w stylu `[excited]`, `[eye roll]` |
| Pokazać ustawienia Gemini tylko dla providera `gemini` | Nie mieszać semantyki ElevenLabs i OmniVoice |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Typy `tsc` zależne od `.next/types` | Odtworzono build przed uruchomieniem `tsc` |
| `workflow B` wymagał przepięcia `geminiStyle/geminiTempo` przez kilka poziomów configu | Rozszerzono `PipelineConfig`, helpery i `buildClientTtsConfig` |
| `workflow A` normalizował `tts.provider/voice1/voice2`, ale pomijał `tts.geminiStyle/geminiTempo` | Dodano te pola do `normalizeIncomingRequest()` w `src/app/api/podcast-video/jobs/route.ts` |
| Shared `normalizeGeminiTempo()` miało błąd i zwracało zawsze `fast` | Naprawiono normalizer w `src/lib/podcast/contracts.ts` |
| Single-segment Gemini TTS padał na `500 INTERNAL`, co psuło `conversation -> workflow B -> gemini` | `createGeminiDialogue()` wysyła teraz Gemini w trybie multi-speaker z dwoma voice configs nawet dla jednego aktywnego speakera |

## Resources
- [src/actions/gemini-tts.ts](/root/AiPodcast/src/actions/gemini-tts.ts)
- [src/app/api/generate-podcast/route.ts](/root/AiPodcast/src/app/api/generate-podcast/route.ts)
- [src/app/api/text-to-speech/route.ts](/root/AiPodcast/src/app/api/text-to-speech/route.ts)
- [src/lib/podcast-video/orchestrator.ts](/root/AiPodcast/src/lib/podcast-video/orchestrator.ts)
- [src/app/api/podcast-video/podcast-film/jobs/route.ts](/root/AiPodcast/src/app/api/podcast-video/podcast-film/jobs/route.ts)
- [src/app/page.tsx](/root/AiPodcast/src/app/page.tsx)
- [src/app/podcast-video/page.tsx](/root/AiPodcast/src/app/podcast-video/page.tsx)

## Visual/Browser Findings
- `/podcast-video` jest już jednym ekranem dla video, z historią renderów, preview ostatniego MP4 i usuwaniem starych jobów.
- Ustawienia Gemini są teraz obecne w UI i powinny być widoczne tylko przy `tts.provider = gemini`.

## Test Artifacts
- `expressive-lite + normal`
  `https://podcast.aihub.ovh/api/archive/dialog_pl_expressive_lite_normal_1776883270115.wav`
- `expressive-lite + fast`
  `https://podcast.aihub.ovh/api/archive/dialog_pl_expressive_lite_fast_1776883297446.wav`
- `plain + normal`
  `https://podcast.aihub.ovh/api/archive/dialog_pl_plain_normal_1776883326283.wav`
- `plain + fast`
  `https://podcast.aihub.ovh/api/archive/dialog_pl_plain_fast_1776883352941.wav`

## Duration Notes
- `expressive-lite + normal`: `75.44s`
- `expressive-lite + fast`: `70.24s`
- `plain + normal`: `75.04s`
- `plain + fast`: `68.84s`

## Live Default Confirmation
- Po restarcie `aipodcast.service` wykonano dry-run probe na `/api/text-to-speech` bez jawnego `geminiStyle` i `geminiTempo`.
- Odpowiedź debug prompt potwierdziła oba defaulty naraz:
  - styl: `Use lively, energetic podcast delivery...`
  - tempo: `Use brisk, energetic pacing with minimal dead air.`
- To oznacza, że live default Gemini jest już ustawiony na `expressive-lite + fast`.

## Full MP4 QA Findings
- `raw_text -> workflow A -> gemini` przeszedł end-to-end po live fixach.
  - job: `podcast_video_1776888816953_im7ndt`
  - wynik: `status=success`, `mp4` wygenerowane lokalnie, `geminiStyle=expressive-lite`, `geminiTempo=fast`
  - finalne MP4 ma około `105.00s`
- `conversation -> workflow B -> gemini` początkowo failował przez single-segment Gemini TTS.
  - wcześniejsze joby: `pbfilm_3f0310e10f4e46c3b4bbba704d8d58e3`, `pbfilm_94dc21576b114856a417f0dd466b6421`
  - wspólny objaw: `Gemini TTS error ... 500 INTERNAL`
- Po fixie single-segment Gemini workflow B przeszedł end-to-end.
  - job: `pbfilm_21e9e294b0524b32a27952cc2486537b`
  - wynik: `state=done`, `success=true`, `tts_engine=gemini`, `direct_tts_model=gemini-3.1-flash-tts-preview`
  - segmenty audio Gemini: `3.28s` i `3.80s`
- Z tego środowiska mogłem potwierdzić techniczny sukces pełnych renderów MP4 i bieżący live default, ale nie zrobić realnego odsłuchu MP4 po polsku.

## Superpowers Cleanup Findings
- Worktree zawiera wiele wcześniejszych zmian spoza bieżącej prośby. Cleanup musi być ograniczony do plików, które są ewidentnie prototypem, martwym kodem albo dokumentacją/handoffem.
- Statyczny prototyp `public/podcast-page-preview.html` został zastąpiony przez stałą zakładkę `Podgląd stylu` w `/podcast-video` i został usunięty jako duplikat UI.
- `public/subtitle-font-preview.html` jest źródłowym wzorcem wizualnym, z którego wyciągaliśmy design. Nie usuwam go bez dodatkowej decyzji, bo dalej pełni rolę referencji.
- `public/title_preview.jpg` jest używany jako awaryjny asset/referencja preview i nie powinien zostać usunięty w tym kroku.
- Globalny `npm run lint` failuje przez starsze błędy w repo, głównie stare skrypty CommonJS oraz `any` w istniejących plikach. Targetowany lint dla nowych plików preview powinien pozostać bez nowych errorów.
- `scripts/final-delivery.js`, `scripts/final-fix.js`, `scripts/parser-shim-v2.js`, `scripts/verify-fixes.js`, `scripts/test-sync.js` i `test-settings.js` nie były referencjonowane przez repo ani `package.json`. To były jednorazowe skrypty testowe zapisujące lokalne artefakty.
- `test-output/` zawiera archiwalne WAV/JSON z testów Gemini. Zamiast kasować artefakty lokalne, dodano katalog do `.gitignore`, bo AGENTS.md wskazuje, że tymczasowe wyniki powinny żyć w ignorowanych lokalizacjach.
- `scripts/test-minimal.ts` był pustym probe env/path z nieużywanymi importami, więc został usunięty jako śmieć.
- `scripts/test-podcast-film-hard-cut.js` sprawdza realną regresję `transition=none`; został zachowany jako `scripts/test-podcast-film-hard-cut.mjs` zamiast usuwania.
- `src/app/api/webhook/test-minio/route.ts` i `src/app/api/v1/generate/route.ts` miały hardcoded fallback credentials. Zostały usunięte; route'y wymagają konfiguracji env albo jawnych query params tam, gdzie route je wspiera.
- Pełny `npm run lint` po cleanupie kończy się exit code 0. Zostały 2 warningi: zależności hooka auto-download w `src/app/page.tsx` i istniejące `<img>` w `src/app/podcast-video/page.tsx`.

## First-Frame Burn-In Findings
- Problem nakładania dwóch napisów pochodził z tego, że zdjęcie używane jako tło pierwszej klatki może mieć własny tekst albo jasne detale w miejscu naszego tytułu.
- Pełny czarny panel technicznie zasłaniał tło, ale był zły wizualnie i nie odpowiadał podglądowi. Został usunięty.
- Realny renderer używa teraz stylu bliższego preview: zielony tytuł, czarny obrys, lekkie przyciemnienie pola zdjęcia, bez lokalnej czarnej podkładki.
- Przyczyną rozjazdu UI/render było to, że style preview były zapisane tylko w `localStorage`. Generator wysyła teraz zapisany `cover_style` do workflow B, a backend używa go przy wypalaniu tytułu.
- Tytuł w rendererze pozostaje formatowany jako jedno słowo na linię, z dynamicznym rozmiarem fontu, marginesem, kolorem, obrysem i przesunięciem Y z preview.
- Obraz kontrolny do oceny wizualnej:
  `https://podcast.aihub.ovh/podcast-first-frame-check.jpg`
