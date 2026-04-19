# Model shootout — 2026-04-19

## Setup

- **Content:** ten sam `../2026-04-18/content.md` (Claude 4.7 + Mythos, ~1200 chars)
- **Prompt:** nowy `defaultHostPersonalitiesPolish` (z 2026-04-18), TTS guard `omnivoice`
- **Endpoint:** realny `POST /api/generate-podcast` (swap przez `OPENROUTER_MODEL` + restart)
- **Cel:** czy mocniejszy LLM rozwiąże problem "perspektywy normalnych ludzi" + gwary

## Wyniki (1 próbka na model)

| # | Model | Avg | Śląska A | Góralska Z | Humor | Norm.ludzie | Osob. | Gram. | # linii |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | **anthropic/claude-opus-4.7** | **6.7** | 8 | **9** | 5 | 1 | 9 | 8 | 9 |
| 2 | **google/gemini-3.1-pro-preview** | **6.3** | 8 | 7 | 5 | 1 | **9** | 8 | 8 |
| 3 | google/gemini-2.5-flash | 5.3 | 7 | 5 | 3 | 1 | 8 | 8 | 9 |
| 4 | deepseek/deepseek-v3.2 | 5.2 | 6 | 6 | 4 | 1 | 7 | 7 | 9 (najkrótszy) |
| 5 | google/gemini-3.1-flash-lite-preview | 4.0 | 3 | 5 | 2 | 1 | 6 | 7 | 8 |
| 6 | minimax/minimax-m2.7 | **3.5** | 3 | 3 | 3 | 1 | 6 | 5 | 16 (ŁAMIE LIMIT) |

### Baseline dla porównania
| Model | Avg |
|---|---|
| v0 stary prompt @ gemini-3-flash-preview | 3.0 |
| v3 nowy prompt @ gemini-3-flash-preview | 5.7 |

## Obserwacje

### Najlepsi: claude-opus-4.7 i gemini-3.1-pro
- **Claude Opus 4.7** — najlepsza góralska Zofia w całym teście. Fonetyczne rendering (`reklamujom`, `bojom`, `przestanom`, `bedom`, `lecom`) konsekwentne i naturalne. Antoni też bardzo dobry (`jo`, `je siekiera!`, `cołke`). Drobny błąd gramatyczny (`masz recja` zamiast `rację`) ale ogólnie najmocniej.
- **Gemini 3.1 Pro** — Antoni świetny (`żech`, `pieruńsko`, `padnę z wrażenia`, `kaj my idymy`). Zofia solidna (`trzęsą portkami`, `kiebyś głębiej pomyślał`). Pojedyncze gagi typu `naiwny chłopce`, `radosny chłopie`. Najmocniejsze osobowości z całego testu.

### Średni: gemini-2.5-flash, deepseek-v3.2
- **Gemini 2.5 Flash** — Antoni dobry, Zofia przeciętna. Bez pointy.
- **DeepSeek V3.2** — NAJKRÓTSZY (9 linii, każda 1-2 zdania), punchy rytm, niezły balans ale powierzchownie.

### Słabi: gemini-3.1-flash-lite, minimax-m2.7
- **Gemini 3.1 Flash Lite** — za słaby na twardy prompt. Kwestie bez pointy, gwara szczątkowa.
- **Minimax M2.7** — **ŁAMIE LIMIT 7-9 LINII** (16 zamiast 9). Gubi polskie znaki (`narzedzie`, `bedzie`). Humor płaski.

## Kluczowy wniosek: "Perspektywa zwykłych ludzi" = 1/10 NA KAŻDYM MODELU

Nawet **Opus 4.7 i Gemini Pro 3.1 nie wygenerowały ani jednego Biedronki/wujka/babci/teściowej**. To znaczy że problem leży nie w mocy modelu, tylko w **strukturze promptu** — wymóg humoru codziennego jest zagłuszany przez:
1. Fakty z `content` (benchmarki, Mythos, giełda) dominują uwagę
2. Sekcja KOMEDIA jest pod sekcją DIALECT/PERSONALITIES, więc traktowana jako "ozdobnik"
3. Przykład wzorcowy jest tylko 1 kwestia Antoni + 1 Zofia — za mało

### Rekomendacja techniczna (do decyzji)

**Podejście A — "najmocniejszy model + stary prompt":**
- Switch na `anthropic/claude-opus-4.7` lub `google/gemini-3.1-pro-preview`
- Dialekt/osobowości b. dobre out-of-the-box
- "Zwykłych ludzi" dalej brak → trzeba patch promptu
- Koszt: Opus ≈ 10x Flash, Gemini 3.1 Pro ≈ 5x Flash

**Podejście B — "ten sam model + agresywny patch promptu":**
- Przenieść sekcję KOMEDIA na sam początek (przed content!)
- Dodać twardy wymóg "min. 1 element z listy: Biedronka/teściowa/wujek/..."
- Rozbudować przykład wzorcowy do 4-6 kwestii z callbackami
- Koszt: zero, ale większe ryzyko że Flash zignoruje

**Podejście C (najrozsądniejsze, moja rekomendacja):**
- **Gemini 3.1 Pro** jako produkcyjny model (5x Flash ale 2x lepsza jakość niż Flash)
- + patch promptu z podejścia B (przeniesienie KOMEDIA na początek + twardy wymóg ludzkich odniesień)
- 1 próbka potwierdza że to ma sens — potem smoke na pełnym pipeline

## Twój wybór

| Wersja | Twoja ocena | Wybór? |
|---|---|---|
| claude-opus-4.7 | __/10 | [ ] |
| gemini-3.1-pro | __/10 | [ ] |
| gemini-2.5-flash | __/10 | [ ] |
| deepseek-v3.2 | __/10 | [ ] |
| gemini-3.1-flash-lite | __/10 | [ ] |
| minimax-m2.7 | __/10 | [ ] |

**Kierunek:** _______ (A / B / C / inny)
