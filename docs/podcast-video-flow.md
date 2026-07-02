# Podcast Video Flow

## Cel

Ten dokument opisuje aktualny, docelowy flow produktu dla generowania podcast video w tym repo.

Zakładamy dwa publiczne wejścia:

- `raw_text`
- `conversation`

Zakładamy dwa workflow wideo:

- `Workflow A` = cover video
- `Workflow B` = avatar video

## Główna zasada

Publicznie wspieramy tylko dwa sensowne tryby wejścia:

1. `raw_text`
2. `conversation`

`normalizedTranscript` i inne stare pola pozostają tylko jako kompatybilność wsteczna albo tryby internal/legacy.

## Architektura End-to-End

### Tryb 1: `raw_text`

```text
raw_text
-> OpenRouter LLM
-> ConversationDraft
-> direct TTS provider
-> Workflow A lub Workflow B
-> final MP4
```

### Tryb 2: `conversation`

```text
conversation
-> direct TTS provider
-> Workflow A lub Workflow B
-> final MP4
```

## Warstwy systemu

### 1. LLM

- Używamy tylko `OpenRouter`
- LLM jest uruchamiany tylko wtedy, gdy wejściem jest `raw_text`
- Endpoint: `POST /api/generate-podcast`

Rola:

- zamienia `raw_text` na `ConversationDraft`
- nie generuje audio
- nie renderuje wideo

### 2. TTS

TTS idzie bezpośrednio do providera, nie przez OpenRouter.

Aktualnie wspierane:

- `gemini`
- `elevenlabs`
- `omnivoice`

Endpoint audio:

- `POST /api/text-to-speech`

W workflow video provider TTS jest przekazywany bezpośrednio do konkretnego pipeline'u video.

### 3. Avatar / render video

Aktualnie wspierany provider avatar:

- `soulx`

Rola:

- generacja segmentów video dla Workflow B
- sklejenie finalnego wideo

## Publiczne wejścia

### Wejście `raw_text`

Użyj, gdy chcesz podać surowy tekst źródłowy, a system ma sam zbudować rozmowę podcastową.

Przykład:

```json
{
  "raw_text": "Długi tekst źródłowy...",
  "title": "AI w biznesie",
  "language": "pl",
  "tts": {
    "provider": "gemini",
    "voice1": "Charon",
    "voice2": "Kore"
  },
  "avatar": {
    "provider": "soulx"
  },
  "review": {
    "mode": "off"
  }
}
```

### Wejście `conversation`

Użyj, gdy rozmowa jest już gotowa i chcesz pominąć etap LLM.

Przykład:

```json
{
  "conversation": [
    { "speaker": "Antoni", "text": "..." },
    { "speaker": "Zofia", "text": "..." }
  ],
  "title": "AI w biznesie",
  "language": "pl",
  "tts": {
    "provider": "elevenlabs",
    "voice1": "FF7KdobWPaiR0vkcALHF",
    "voice2": "BpjGufoPiobT79j2vtj4"
  },
  "avatar": {
    "provider": "soulx"
  }
}
```

## Reguły walidacji

- request musi zawierać dokładnie jedno z pól:
  - `raw_text`
  - `conversation`
- jeśli są oba pola naraz, API zwraca `400`
- jeśli nie ma żadnego z nich, API zwraca `400`

## Workflow A i Workflow B

### Workflow A

Endpoint:

- `POST /api/podcast-video/jobs`

Przeznaczenie:

- cover video
- klasyczny pipeline wideo z artefaktami audio/captions/video

Wejścia:

- `raw_text`
- `conversation`
- legacy `transcript`

TTS:

- `gemini`
- `elevenlabs`

Ograniczenie:

- `omnivoice` nie jest wspierany publicznie w Workflow A

Typowy flow:

```text
raw_text -> OpenRouter -> conversation -> gemini/elevenlabs -> cover render -> MP4
```

albo:

```text
conversation -> gemini/elevenlabs -> cover render -> MP4
```

### Workflow B

Endpoint:

- `POST /api/podcast-video/podcast-film/jobs`

Przeznaczenie:

- avatar video
- segmenty video renderowane przez `SoulX`

Wejścia:

- `raw_text`
- `conversation`

TTS:

- `gemini`
- `elevenlabs`
- `omnivoice`

Avatar:

- `soulx`

Typowy flow:

```text
raw_text -> OpenRouter -> conversation -> gemini/elevenlabs/omnivoice -> SoulX -> MP4
```

albo:

```text
conversation -> gemini/elevenlabs/omnivoice -> SoulX -> MP4
```

## Review Mode

Wspierane wartości:

- `off`
- `pause_after_conversation`

### `review.mode = off`

Pipeline idzie od razu end-to-end.

### `review.mode = pause_after_conversation`

Działa tylko sensownie dla wejścia `raw_text`.

Flow:

```text
raw_text
-> OpenRouter
-> conversation draft
-> stop
```

W tym trybie API zwraca draft rozmowy zamiast od razu uruchamiać render.

Potem użytkownik może:

1. sprawdzić draft
2. poprawić go
3. wysłać go ponownie jako `conversation`
4. uruchomić finalny render

## UI: `/podcast-video`

Aktualny ekran `/podcast-video` jest centrum sterowania video i ma dwie górne zakładki:

- `Generator` - właściwy workflow tworzenia podcast video.
- `Podgląd stylu` - stały panel do ustawiania wyglądu napisów, nagłówka i tytułu z pierwszej klatki.

Sekwencja w zakładce `Generator`:

1. Krok 1: wybór wejścia
   - `TEKST`
   - `CONVO`
   - `TRANSCRIPT` tylko dla Workflow A
2. Krok 2: wybór workflow
   - `A / COVER VIDEO`
   - `B / AVATAR VIDEO`
3. Krok 3: wybór TTS i dwóch głosów
   - dla `tts.provider = gemini` UI pokazuje dodatkowo `Gemini Style` i `Gemini Tempo`
   - aktualny live default Gemini to `expressive-lite + fast` na modelu `gemini-3.1-flash-tts-preview`
   - dla `language = en` Gemini TTS dostaje język-aware prompt wykonawczy; ma mówić naturalnym angielskim, bez polskiej fonetyki, z lekkim `British-leaning` kierunkiem w prosody
4. Krok 4: review, captions i ustawienia renderu
5. Krok 5: podsumowanie i `Generuj`

Po uruchomieniu:

- status joba aktualizuje się na tej samej stronie
- po sukcesie gotowy film wraca do sekcji preview MP4

Zakładka `Podgląd stylu`:

- korzysta z oprawy wizualnej wyciągniętej z `public/subtitle-font-preview.html`
- zapisuje lokalne domyślne ustawienia w `localStorage` pod kluczem `ai-podcast-video-style-defaults`
- ma reset do obecnie ustalonego presetu produktu:
  - nagłówek: `AI W BIZNESIE PL`
  - pozycja nagłówka od góry: `42`
  - wygięcie nagłówka: `132`
  - szerokość łuku nagłówka: `450`
  - tytuł: każde słowo w osobnym wierszu
  - tytuł: centrowanie w pionie i poziomie w polu obrazu
  - tytuł: automatyczne zmniejszanie przy zbyt długim tekście zamiast ucinania

Ważne ograniczenie:

- zapisane ustawienia `Podglądu stylu` są dziś ustawieniami UI/preview
- backendowy renderer MP4 nadal wymaga osobnego rozszerzenia kontraktu, jeśli ma wypalać nagłówek i tytuł dokładnie według tych samych parametrów

## Provider Matrix

| Warstwa | Wspierane dziś |
|---|---|
| LLM | `openrouter` |
| TTS | `gemini`, `elevenlabs`, `omnivoice` |
| Avatar | `soulx` |

## Gemini Defaults

Aktualny produkcyjny default dla Gemini:

- model: `gemini-3.1-flash-tts-preview`
- style: `expressive-lite`
- tempo: `fast`

Dodatkowe zachowanie dla `EN`:

- `/api/text-to-speech` i pośrednio oba workflow przekazują top-level `language` do Gemini TTS
- prompt wykonawczy jest teraz zależny od języka; nie zakłada już zawsze polskiego
- dla `language = en` dochodzi lekki hint na natural English delivery i subtelnie brytyjską prosody
- to poprawia naturalność odsłuchu, ale nie jest kontraktem na prawdziwy akcent `en-GB`

Te wartości są dziś przepięte przez:

- `POST /api/generate-podcast`
- `POST /api/text-to-speech`
- `POST /api/podcast-video/jobs`
- `POST /api/podcast-video/podcast-film/jobs`
- `/`
- `/podcast-video`

## Publiczne endpointy

### `POST /api/generate-podcast`

Rola:

- `raw_text -> conversation`

Uwagi:

- używa OpenRouter
- nie renderuje audio ani video

### `POST /api/text-to-speech`

Rola:

- `conversation -> audio`

Uwagi:

- używa bezpośredniego providera TTS
- przy `tts.provider = gemini` respektuje top-level `language`
- dla `language = en` steruje delivery promptem pod natural English zamiast polskiego readout

### `POST /api/podcast-video/jobs`

Rola:

- Workflow A

### `POST /api/podcast-video/podcast-film/jobs`

Rola:

- Workflow B

## Legacy / compatibility

Pola nadal mapowane wewnętrznie, ale nie są już preferowanym kontraktem publicznym:

- `content`
- `script_text`
- string `transcript`
- `normalizedTranscript`
- `tts_engine`
- top-level `provider`

## Co jest źródłem prawdy

Aktualnie:

- publiczny kontrakt API: [`PUBLIC_API.md`](../PUBLIC_API.md)
- architektura i flow produktu: ten dokument
- bieżąca lista prac: [`TODO.md`](../TODO.md)
- historia zmian i handoff sesji: [`task_plan.md`](../task_plan.md), [`findings.md`](../findings.md), [`progress.md`](../progress.md)
- pamięć projektowa: [`AGENTS.md`](../AGENTS.md)

## Stan aktualny

Ten dokument opisuje stan wdrożony po refaktorze dual-input API, po przeniesieniu kontroli video do `/podcast-video` oraz po dodaniu stałej zakładki `Podgląd stylu`.
