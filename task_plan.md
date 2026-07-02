# Task Plan: Gemini TTS Production Hardening

## Goal
Domknąć produkcyjne ustawienia Gemini TTS dla polskiego podcastu i zostawić trwały handoff do kolejnej sesji bez utraty kontekstu.

## Current Phase
Phase 8

## Phases

### Phase 1: Discovery and architecture alignment
- [x] Potwierdzić docelową architekturę `raw_text | conversation`, OpenRouter-only dla LLM i direct TTS.
- [x] Potwierdzić ograniczenia Gemini TTS i sposób sterowania ekspresją.
- [x] Zidentyfikować miejsca integracji w API, workflow A/B i UI.
- **Status:** complete

### Phase 2: Public API and workflow refactor
- [x] Ustandaryzować dual-input contract w backendzie.
- [x] Wystawić wspólne sterowanie TTS i avatar przez workflow A/B.
- [x] Spiąć `/podcast-video` jako jeden ekran sterowania video.
- **Status:** complete

### Phase 3: History, preview and product UX
- [x] Dodać ostatni MP4 i historię renderów do `/podcast-video`.
- [x] Dodać usuwanie starych renderów.
- [x] Uporządkować layout strony w tryb krok po kroku.
- **Status:** complete

### Phase 4: Gemini expressiveness and tempo
- [x] Dodać `geminiStyle = plain | expressive-lite`.
- [x] Dodać `geminiTempo = normal | fast`.
- [x] Ograniczyć Gemini tags do whitelisty: `[laughing]`, `[sigh]`, `[uhm]`, `[short pause]`.
- [x] Przepiąć to przez `/api/generate-podcast`, `/api/text-to-speech`, workflow A, workflow B i UI.
- [x] Wygenerować 4 dialog-only WAV testy i porównać warianty.
- **Status:** complete

### Phase 5: Production default and handoff
- [x] Ustawić `expressive-lite + fast` jako domyślny wariant Gemini.
- [x] Potwierdzić live behavior po restarcie usługi.
- [x] Zapisać plan, findings, progress i prompt startowy do kolejnej sesji.
- **Status:** complete

### Phase 6: Next-session product QA
- [x] Zweryfikować technicznie pełne flow w UI/API dla `raw_text -> workflow A -> gemini`.
- [x] Zweryfikować technicznie pełne flow w UI/API dla `conversation -> workflow B -> gemini`.
- [x] Naprawić wykryte regresje Gemini w workflow A/B przed dalszym QA.
- [ ] Odsłuchać pełne MP4 po polsku i potwierdzić, czy `expressive-lite + fast` nadal wygrywa względem innych wariantów.
- [ ] W razie potrzeby dopracować prompt Gemini pod polski bez ruszania modelu `gemini-3.1-flash-tts-preview`.
- [x] Zaktualizować dokumentację tak, aby bieżący live default Gemini był zapisany jako `expressive-lite + fast`.
- **Status:** in_progress

### Phase 7: Superpowers cleanup and documentation
- [x] Zinwentaryzować dirty worktree i rozdzielić aktywną pracę od kandydatów do cleanupu.
- [x] Usunąć oczywiste prototypy/śmieci po przeniesieniu preview do aplikacji.
- [x] Usunąć martwe importy/kod wykryte przez targetowane narzędzia.
- [x] Uporządkować dokumentację i plan/handoff po zmianie stałej zakładki preview.
- [x] Zweryfikować `tsc`, build i lint.
- **Status:** complete

### Phase 8: First-frame title burn-in QA
- [x] Odtworzyć problem nakładania tytułu na tekst lub detale wypalone w zdjęciu.
- [x] Usunąć ciężką czarną podkładkę i dopasować realny renderer do stylu z podglądu.
- [x] Zachować format tytułu: każde słowo w nowej linii, auto-fit i centrowanie w polu obrazu.
- [x] Przesyłać zapisany `cover_style` z podglądu do workflow B.
- [x] Odświeżyć publiczny obraz kontrolny pierwszej klatki do sprawdzenia.
- [x] Zweryfikować `tsc`, `lint`, build, restart usługi i publiczny URL kontrolny.
- **Status:** complete

## Key Questions
1. Czy `expressive-lite + fast` pozostaje najlepszym defaultem również po renderze pełnego filmu?
2. Czy trzeba jeszcze przyciąć prompt Gemini dla polskiego, jeśli w pełnym flow wyjdą artefakty wymowy lub zbyt agresywnego tempa?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Zostawić `gemini-3.1-flash-tts-preview` jako model domyślny | Użytkownik wyraźnie nie chce wracać do 2.5; iterujemy promptem i tagami, nie modelem |
| Wprowadzić `expressive-lite` zamiast szerokiego systemu emocji | Mały whitelist jest bardziej przewidywalny dla polskiego |
| Tempo zrobić jako enum `normal | fast`, nie numeric slider | Obecna integracja Gemini jest prompt-driven; enum jest bezpieczniejszy |
| Ustawić `expressive-lite + fast` jako default | Z testów odsłuchowych i 4-wariantowej matrycy to był kierunek preferowany do produkcji |
| Cleanup wykonywać konserwatywnie | Repo jest mocno brudne; usuwamy tylko dowiedzione prototypy/martwe fragmenty, nie aktywne endpointy ani smoke scripts bez dowodu |
| Usunąć jednorazowe skrypty final/verify z ElevenLabs | Nie były podpięte w `package.json`, nie miały importów poza sobą, zapisywały artefakty lokalne i generowały legacy lint noise |
| Zachować hard-cut smoke, ale przepisać go na ESM | Test sprawdza konkretną regresję concat, więc nie jest martwy; problemem był tylko stary CommonJS |
| Usunąć hardcoded fallback credentials | Sekrety nie mogą być w kodzie; route ma wymagać env albo jawnych query params |
| Realny tytuł pierwszej klatki ma używać ustawień z preview | Zapis w `localStorage` sam nie trafia na backend; UI musi wysłać `cover_style` w payloadzie workflow B |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `npx tsc --noEmit` nie znajdował `.next/types/*` | 1 | Najpierw uruchomiono `npm run build`, żeby odtworzyć Next types, potem `tsc` przeszedł |
| `preparePipelineInput` nie miało `geminiStyle/geminiTempo` w typie `Pick<PipelineConfig,...>` | 1 | Rozszerzono typ o pola Gemini |
| Workflow A ignorował `tts.geminiStyle/geminiTempo` z `/podcast-video` | 1 | Dodano normalizację tych pól w `src/app/api/podcast-video/jobs/route.ts` |
| `normalizeGeminiTempo()` zwracało zawsze `fast` | 1 | Naprawiono shared normalizer w `src/lib/podcast/contracts.ts` |
| Single-segment Gemini TTS zwracał `500 INTERNAL`, co blokowało workflow B | 2 | W `src/actions/gemini-tts.ts` wymuszono dwu-głosową konfigurację Gemini nawet dla jednego aktywnego speakera, z duplikatem tego samego voice |
| `npx tsc --noEmit` po typowaniu parsera wskazał nullable pola voice segmentów | 1 | Rozszerzono typ wejścia parsera o `null` i użyto bezpiecznych fallbacków |

## Notes
- Domyślny styl Gemini: `expressive-lite`
- Domyślne tempo Gemini: `fast`
- Dialog-only test matrix jest już zapisana w `archive/` i pod publicznymi URL-ami
- Live probe `/api/text-to-speech` bez jawnego `geminiTempo` potwierdził prompt z `Use brisk, energetic pacing with minimal dead air`
- Live QA artefakty tej sesji:
  - Workflow A MP4: `podcast_video_1776888816953_im7ndt`
  - Workflow B MP4: `pbfilm_21e9e294b0524b32a27952cc2486537b`
- Następna sesja powinna zacząć już tylko od ludzkiego odsłuchu tych pełnych MP4 po polsku
- Publiczny proof pierwszej klatki po masce tytułu:
  `https://podcast.aihub.ovh/podcast-first-frame-check.jpg`
