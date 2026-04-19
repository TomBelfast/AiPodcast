# Rogan-style prompt on OPUS 4.7 — 2026-04-19

## Setup
- **Model:** `anthropic/claude-opus-4.7`
- **Prompt:** IDENTYCZNY jak w `../2026-04-19-rogan/` (v3 Rogan, TOP PRIORITY, twardy codzienny wymóg, limit 160 zn)
- **Content:** ten sam

## Porównanie Opus vs Gemini 3.1 Pro (ten sam prompt)

| Metryka | Cel | Gemini 3.1 Pro | **Opus 4.7** |
|---|---|---:|---:|
| Wymian | 10-14 | 8/8/8 | 9/9/9 |
| Śr. długość kwestii | ≤160 zn | 175/213/183 | **99/120/112** ✅ |
| Kwestie >160 zn | 0 | 22/24 ❌ | **0/27** ✅ |
| Śląska gwara (Antoni) markery | ≥2/kw | 1.25/2.75/2 | 1.75/2/2.75 |
| Góralska gwara (Zofia) markery | ≥2/kw | 3/3.5/1 | 5/2.25/3.75 |
| **Codzienne elementy** (Biedronka, wujek...) | ≥1/kw = 9+ | 0/0/0 | **0/0/1** |
| Naturalność rytmu | Rogan | monolog | **ping-pong** ✅ |

## Wyniki Opus — trzy runy

**Run 1 (9 wymian, 885 zn total, avg 98 zn/kwestia):**

1. [Antoni] (89) "Jo, Zofia, słyszałaś? Anthropic wypuścił Claude cztery kropka siedem i to je istno bomba!"
2. [Zofia] (81) "Hej, ino spokojnie. Kilkanaście procent lepiej w testach to jesce nie rewolucyja."
3. [Antoni] (98) "Ale obrazy rozumie trzy razy lepij! I projektuje cołke strony ino z opisu tekstowego! Fajnie, nie?"
4. [Zofia] (136) "Fajnie, kiebyś zauważył, co oni schowali. Majom tajny model, Mythos sie woło, duzo mocniejsy, ale go nie wypuscom, bo som niebezpieczny."
5. [Antoni] (87) "Ja! Sekretny super model! Czamu żeś mi tego od razu nie pedziała? To brzmi jak z filmu!"
6. [Zofia] (131) "Bo to marketing, chłopce. A tymcasem stare aplikacyje na poprzednim Claude przestajom dziołać, bo nowe instrukcyje som za dosłowne."
7. [Antoni] (92) "No dobra, ale te routines na chmurze? Automatyzujom cołki workflow! To je przyszłość, jakże!"
8. [Zofia] (113) "Przysłość, kiej programiści tracom robota. Akcyje firm softwarowych juz lecom w dół. Nie kozdy bedzie zachwycony."
9. [Antoni] (58) "No tak. Ale jo i tak testuja jesce dzisiej. Dzięki, Zofia!"

**Run 3 (9 wymian, 1005 zn, avg 112 zn/kwestia):**

1. [Antoni] "Jo, Zofia, słyszałaś? Anthropic wydoł Claude cztery kropka siedem i to je fajnie mocne!"
2. [Zofia] "Hej, słyszałam. Kilkanaście procent lepiej w inzynierii. Nic takiego, kiebyś wiedzioł, co to znacy naprowde."
3. [Antoni] "Ino posłuchej! Trzy razy lepij rozumi obrazki... Siekiera, to je rewolucja!"
4. [Zofia] "Rewolucja, hej. A wiedzioł żeś, że oni majom sekretny model Mythos, co go nie wypuscajom?"
5. [Antoni] "Co? Sekretny super model? Kaj oni go chowajom? Czymu nie dadzom ludziom pobawić sie?"
6. [Zofia] "Bo som obawy o nadużycia, naiwniaku. Ale mnie bardzi martwi, że nowe instrukcje som dosłowne."
7. [Antoni] "No dobra, ale te routines! Automatyzacjo cołych przepływów w chmurze!"
8. [Zofia] "Lekko? Hej, akcje firm softwarowych już lecom w dół. Twoja radość je, kieby na **Titanicu**." ← jedyny daily-element z 27 kwestii
9. [Antoni] "Oj Zofia, zawse musisz popsuć nastrój!"

## Kluczowe wnioski

### Opus wygrywa z Gemini w 4 wymiarach
1. **Tempo Rogan-style** ✅ — 100% kwestii ≤160 zn (Gemini: 8% respektuje limit)
2. **Krótsze zdania, bez pompatycznego tonu** — avg 100-120 zn vs Gemini 175-210 zn
3. **Lepszy balans** (mniej tech-ekspozycji, więcej szybkich reakcji)
4. **Bardzo dobra góralska Zofia** (run 3: `wiedziolaś żeś`, `wypuscajom`, `bardzi martwi`, `lecom`, `kieby`)

### Ale problem codziennych elementów **NIE ZNIKA**
- Opus przez 27 kwestii dał **1 codzienny element** (`Titanicu` — i to nawet nie jest PL specific)
- Zero Biedronki, Żabki, teściowej, wujka, PKP, ZUS, proboszcza
- To potwierdza: **problem nie jest w modelu, tylko w strukturze promptu + naturze zadania**
- LLM chce być koherentny z `content` (AI, Mythos, giełda) — kotwica semantyczna silniejsza niż instrukcja

## Rekomendacja po tym teście

**Opus 4.7 + nowy prompt to znacząca poprawa** (snappy dialog, mocna gwara, solidne osobowości — ~**7/10**). Dla podcastu "info + humor + gwara" to już jest bardzo dobre.

Dla "Biedronka w każdej kwestii" **żaden model tego nie zrobi przez sam prompt**. Trzy drogi:

1. **Zaakceptować obecny poziom** i jechać pipeline z Opus 4.7.
2. **Retry-until-happy** — w `generate-podcast/route.ts` po otrzymaniu dialogu zliczyć `daily_markers`; jeśli < threshold, retry z dopiskiem "YOU MISSED: wstaw Biedronkę/teściową". Max 2 retry. Koszt: +2-3x tokeny średnio.
3. **Content rewriting** — backend przed podaniem content modelowi przepisuje artykuł na "AI-to-życie-codzienne". Dwa calls LLM, drogie.

## Decyzja do Ciebie

Który kierunek?
- [ ] Akceptuję Opus 4.7 + nowy prompt jako final (7/10). Jedziemy pipeline.
- [ ] Dodaj retry-until-happy (koszt +2-3x, zysk: gwarancja codziennych elementów)
- [ ] Dodaj content rewriting (koszt +2x, zysk: głębsza integracja codzienności)
- [ ] Coś innego? ___
