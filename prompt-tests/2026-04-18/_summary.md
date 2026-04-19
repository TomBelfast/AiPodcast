# Prompt test — 2026-04-18

## Kontekst

- **Content:** `content.md` (Claude 4.7 + Mythos, ~1200 chars)
- **Model LLM:** `google/gemini-3-flash-preview` via OpenRouter
- **TTS guard:** `omnivoice` (bez `[laughs]`, bez em-dashów)
- **Endpoint:** `POST /api/generate-podcast` (tylko tekst, bez TTS/video)
- **Baseline (v0):** `v0_baseline.md` — stary prompt, ocena **3/10**
- **Nowy prompt:** sekcje 1) TWARDY WYMÓG gwary (min. 2 słowa/kwestię) 2) STYL KOMEDIOWY 3) Przykład wzorcowy

## Moja punktacja (1-10, średnia z 6 kryteriów)

| # | Avg | Śląska A | Góralska Z | Humor | Norm. ludzie | Osob. | Gram. | Najmocniejsze |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| v0 baseline | 3.0 | 1 | 4 | 2 | 1 | 7 | 8 | — |
| v1 | **4.3** | 2 | 5 | 3 | 1 | 7 | 8 | "ciemne chmury nad doliną" |
| v2 | **5.3** | 2 | 6 | 5 | 3 | 8 | 8 | "halny w worku", "cyferki dla naiwnych" |
| v3 | **5.7** | **6** | 7 | 4 | 2 | 7 | 8 | "Jo żech wiedzioł", "Kaj tam strach" |
| v4 | **5.7** | 3 | **8** | 5 | 3 | 8 | 7 | "trzesom portkami", "wypierajom", "przekonás" |
| v5 | **4.3** | 2 | 4 | 3 | 2 | 7 | 8 | "Tyz mi ułatwienie" |

## Ranking

1. **v3** i **v4** ex aequo (5.7) — każda z własnym atutem
   - **v3:** Antoni gada najbardziej po śląsku (żech, kaj)
   - **v4:** Zofia gada najbardziej po góralsku (fonetyczny rendering)
2. **v2** (5.3) — najlepszy sarkazm i humor
3. **v1, v5** (4.3) — poprawa nad baseline, ale blado

## Kluczowe obserwacje

### Co poprawiło się po patchu
- **Gwara** – widocznie mocniej obecna. Signature zwroty ("Jo Ci godom", "Hej Antoni", "Tyż mi") pojawiają się regularnie.
- **Fonetyczne oddanie góralskiej** (v4: `wypierajom`, `bojom`, `trzesom`) — Flash potrafi jeśli go zmusić.
- **Osobowości nietknięte** — Antoni dalej entuzjastyczny, Zofia sarkastyczna. OK.

### Czego NIE udało się wymusić
- **"Perspektywa normalnych ludzi" — fiasko (1-3/10).** Zero Biedronki, teściowej, wujka, babci, Żabki, PKP. Model trzyma się tematu AI/giełda/programiści. Signal nie przebił się przez TTS guard + konkrety o Mythos/benchmarkach.
- **Min. 2 słowa gwary/kwestię** — nie spełniane w 100%. Antoni średnio 0.5-1.5/kwestię. Zofia lepiej (2-3/kwestię). Model "rozumie" cel ale oszczędza.
- **Callbacki** — słabe, rzadko.

### Propozycje na v2 patcha (jeśli zdecydujesz się iterować)
1. **Wymusić perspektywę zwykłych ludzi równie twardo jak gwarę:**
   > "W KAŻDEJ kwestii OBOWIĄZKOWO min. 1 element z listy: teściowa, sąsiad, Biedronka, Żabka, PKP, ZUS, babcia, wujek, kolejka, dentysta, kapusta, tramwaj, busowiak, proboszcz, szwagier. Brak = kwestia błędna."
2. **Przenieść sekcję KOMEDIA na sam początek prompta** (teraz jest po personalities — Flash może gubić ważność przez odległość od początku).
3. **Zmienić LLM na mocniejszy dla polskich podcastów** — np. `anthropic/claude-sonnet-4.5` lub `openai/gpt-4o`. Flash jest najtańszy ale najsłabiej trzyma wymagania stylistyczne.
4. **Alternatywa: obniżyć wymóg z "KAŻDA kwestia" → "co druga kwestia"** — może pomóc LLM lepiej balansować gwarę + humor + fakt.

## Twój wybór

Wersja | Ocena | Czy jako kierunek?
---|---|---
v3 | __/10 | [ ] tak / [ ] nie
v4 | __/10 | [ ] tak / [ ] nie
v2 | __/10 | [ ] tak / [ ] nie
v1 | __/10 | [ ] tak / [ ] nie
v5 | __/10 | [ ] tak / [ ] nie

**Następny krok:** uzupełnij oceny, wybierz jeden z kierunków (np. "weźmy v3 + dodamy normal-people hard requirement") i ruszamy dalej.
