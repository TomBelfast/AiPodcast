# Rogan-style prompt test — 2026-04-19

## Setup
- **Model:** `google/gemini-3.1-pro-preview`
- **Prompt:** v3 Rogan-style (TOP PRIORITY + twardy wymóg codzienności + limit 160 zn + 10-14 wymian)
- **Content:** `../2026-04-18/content.md`

## Metryki z 3 runów

| Metryka | Cel | Run 1 | Run 2 | Run 3 | Status |
|---|---|---:|---:|---:|---|
| Liczba wymian | 10-14 | 8 | 8 | 8 | ❌ model ignoruje |
| Średnia długość kwestii | ≤160 zn | 183 | 213 | 175 | ❌ przekroczone we wszystkich |
| Śląska gwara (Antoni) | ≥2/kw | 5/4kw=1.25 | 11/4kw=2.75 | 8/4kw=2 | ✅ run 2-3 |
| Góralska gwara (Zofia) | ≥2/kw | 12/4kw=3 | 14/4kw=3.5 | 4/4kw=1 | ⚠️ run 3 slaby |
| **Codzienne elementy** | ≥1/kw = 8+ | **0** | **0** | **0** | 🔴 **TOTAL FAIL** |

## Co działa
- ✅ Gwara utrzymuje się twardo (run 2 szczególnie: `kcioł`, `podniecos`, `bedzies`, `syćko`, `bedom`, `kozdy`)
- ✅ Osobowości mocno zróżnicowane (Antoni hype, Zofia sarkazm)
- ✅ Długości kwestii zeszły z ~300 (wcześniejsze runy) do ~170-210 — lepiej, ale limit 160 i tak przekroczony

## Co NIE działa — problem strukturalny promptu
- 🔴 **Zero Biedronki / teściowej / wujka / PKP / ZUS / Żabki w całym 24-kwestyjnym korpusie**, pomimo że:
  - Lista jest na SAMYM POCZĄTKU promptu (priorytet #1)
  - Jest "TWARDY WYMÓG"
  - Jest pełny 8-linijkowy przykład z Biedronką, ZUS-em, proboszczem, szwagrem, teściową
- 🔴 Model **łamie limit długości** (160 zn → produkuje 170-230)
- 🔴 Model **ignoruje 10-14 wymian** (daje 8 zawsze — trzyma się starego formatu)

## Najciekawsze cytaty (mimo braku daily elements)
- Run 1: `"To som ino puste cyferki"`, `"Jesce powie... naiwny żeś jak teściowa po różańcu"` (z przykładu!)
- Run 1 Zofia: `"cwany marketing dla ceprów"` — góralski slang dla turystów, niezłe
- Run 2: `"leci na pysk"`, `"ziarenko co ci podrzucą"`
- Run 3: `"Naiwny byłeś od początku i naiwny zostaniesz do samego końca"` — mocne

## Diagnoza: dlaczego codzienne elementy NIE działają

Gemini 3.1 Pro **silnie anchorkuje się na tech-terminach** z sekcji `Content` (Claude, Mythos, benchmarki, giełda, chmura). Lista daily elements + przykład = "sugestia", nie "constraint". Trzy sposoby jak to forsować:

1. **Two-pass generation** — LLM najpierw generuje "daily-life analogy per fact", potem dialog. Najdroższe, najpewniejsze.
2. **Content rewrite** — zamiast podawać surowy artykuł, backend przetworzy go na "punkty do wyśmiania", każdy z codzienną analogią. Dalej drogie.
3. **Post-filter + retry** — jeśli wygenerowany dialog nie ma X codziennych markerów, automatyczny retry z "YOU MISSED daily elements — redo". Najtaniej.
4. **Switch model** — może Opus 4.7 lepiej traktuje wymogi jako hard constraint.

## Decyzje do Ciebie

1. **Czy to co mamy JEST już wystarczające?** (mocna gwara + osobowości + snappy-ish, bez codzienności — 6.5/10)
2. Czy iterujemy w stronę (1-4) i jeśli tak — **które**?
3. Czy **spróbujmy Opus 4.7 z tym nowym promptem** żeby sprawdzić czy to sprawa modelu?
