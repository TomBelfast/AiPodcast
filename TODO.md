# TODO: AiPodcast

Ten plik jest krótką listą bieżących prac. Historyczne notatki z Pipeline B, Gemini TTS i Matrix są zachowane w `task_plan.md`, `findings.md`, `progress.md` oraz w `docs/podcast-video-flow.md`.

## Stan Aktualny

- `/podcast-video` jest głównym ekranem pracy z video.
- Ekran ma dwie zakładki: `Generator` oraz `Podgląd stylu`.
- `Podgląd stylu` jest stałym panelem aplikacji, a nie jednorazowym prototypem HTML.
- Obecny domyślny styl nagłówka preview:
  - tekst: `AI W BIZNESIE PL`
  - góra: `42`
  - wygięcie: `132`
  - szerokość łuku: `450`
- Domyślny tytuł w preview jest dzielony tak, że każde słowo trafia do osobnego wiersza, jest centrowany w pionie i poziomie oraz automatycznie zmniejszany do dostępnego pola.
- Domyślny Gemini TTS pozostaje `gemini-3.1-flash-tts-preview` z `geminiStyle=expressive-lite` i `geminiTempo=fast`.

## Aktywne Zadania

1. Podłączyć zapisane ustawienia preview do docelowego kontraktu renderera MP4, jeśli tytuł/nagłówek mają być wypalane dokładnie według tych ustawień.
2. Przenieść domyślne ustawienia stylu z `localStorage` do ustawień użytkownika/backendu, jeśli mają być współdzielone między przeglądarkami.
3. Zrobić ludzki odsłuch pełnych MP4 po polsku dla wariantu Gemini `expressive-lite + fast`.
4. Dokończyć porządkowanie legacy lintu w starszych endpointach i skryptach.
5. Zdecydować, czy `public/subtitle-font-preview.html` ma zostać jako referencja wizualna, czy trafić do archiwum poza aplikacją.

## Zasady Porządkowe

- Nie dodawać nowych jednorazowych skryptów bez wpisu w `package.json` albo krótkiej notatki w dokumentacji.
- Tymczasowe wyniki audio/video trzymać w ignorowanych katalogach, np. `archive/` albo `test-output/`.
- Nie wracać do Gemini 2.5 bez wyraźnej decyzji produktu.
