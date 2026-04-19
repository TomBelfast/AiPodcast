# Gemini 3.1 Pro + prompt 220 zn / 10 wymian / target 1.5-2.5 min — 2026-04-19

## Setup
- **Model:** `google/gemini-3.1-pro-preview`
- **Zmiany w promptcie:**
  - `MAX 160 znaków` → `MAX 220 znaków` na kwestię
  - `MAX 1-2 zdania` → `MAX 2-3 zdania`
  - `Total: 10-14 wymian` → `DOKŁADNIE 10 wymian`
  - Dodane: `Łącznie cały dialog 1600-2200 znaków` i wyraźny cel `1.5-2.5 min`

## Wyniki — wszystkie 3 runy

| Run | # wymian | Avg zn | Max zn | Over 220 | Całość zn | Czas | Min | Cel 1.5-2.5 min |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 8 | 173 | 188 | **0** ✅ | 1388 | 1:32 | 1.54 | ✅ |
| 2 | 8 | 207 | 214 | **0** ✅ | 1659 | 1:50 | 1.84 | ✅ |
| 3 | 8 | 185 | 209 | **0** ✅ | 1481 | 1:38 | 1.65 | ✅ |

**Wynik: 3/3 runy w targecie długości. 0/24 kwestii przekroczyło limit 220 zn.**

## Porównanie: stary vs nowy prompt na Gemini 3.1 Pro

| Metryka | Stary (160 zn) | **Nowy (220 zn)** |
|---|---:|---:|
| Wymian | 8 | 8 (bez zmian) |
| Avg długość | 233 zn | **188 zn** ✅ |
| Max długość | 333 zn | **214 zn** ✅ |
| Over limit | 8/8 = 100% ❌ | **0/24 = 0%** ✅ |
| Czas | 2:05 | **1:47 avg** ✅ |
| W targecie 1.5-2.5 min | 3/3 | **3/3** ✅ |
| Gwara Antoni /kw | 1.7 | 1.2 ⚠️ |
| Gwara Zofia /kw | 1.6 | 1.3 ⚠️ |

## Obserwacje

### Co działa ✅
1. **Długość targetu zbita 3/3** — idealne trafienie
2. **Limit 220 zn respektowany w 100%** — radykalna zmiana vs 160 zn (którego model kompletnie ignorował)
3. **Kwestie czytelne, 2-3 zdania** — nie monologi, nie tyrady
4. **Osobowości mocne:**
   - Antoni: `dziołcha`, `pieronie`, `fest ułatwią`, `gibko do przodu`, `kaj tam zaraz`
   - Zofia: `głupiś jak but`, `naiwny jak ta owca na wietrze`, `dutki a nie chowali`, `lata na łeb na syję`

### Co dalej nie idzie ⚠️
1. **8 wymian zamiast 10.** Gemini Pro konsekwentnie: mówi 8, nieważne czy każesz 10 czy 10-14. Nie przeskakuje przez tę barierę.
2. **Gwara lekko słabsza** — 1.2/1.3 zamiast 1.7/1.6. Pod ciśnieniem limitu model dropuje markery na rzecz contentu. W run 2-3 Zofia ma momentami neutralny polski (`Widziałam`, `Przecież`).
3. **Run 2 — dla mnie najsłabszy** — dialog "książkowy", za dużo logiki ("weź tyz pomyśl logicznie chłopcze"), za mało szybkich pointów.
4. **Run 1 — najlepszy** — mocne otwarcie "jo jestem w szoku... jaki gryfny", potem Zofia "marketingowa gadka", tempo, sarkazm.

## Verdict

**Gemini 3.1 Pro + nowy prompt = produkcja-ready dla długości 1.5-2.5 min.**

Profil modelu:
- ✅ Długość — idealna
- ✅ Limit zn — respektowany
- ✅ Osobowości — mocne
- ⚠️ Gwara — trochę słabsza, ale nadal obecna
- ⚠️ Liczba wymian — 8 zamiast 10 (nie blocker)

## Sugestie (opcjonalne tuningi)

1. **Jeśli chcesz jeszcze mocniejszej gwary** — dodaj w promptcie explicite "OBOWIĄZKOWO min. 3 markery gwarowe w KAŻDEJ kwestii". Ale ryzyko: przy 220 zn + 3 markery + sens = może się posypać.
2. **Jeśli chcesz 10 wymian** — jedyna droga to zwiększyć limit znaków razem z docelową liczbą. Przy 220 zn × 10 = 2200 zn = 2.5 min (górny limit). Ale model i tak może zignorować. Wymaga retry-until-happy.
3. **Proponuję:** zaakceptować obecny stan, zrobić E2E smoke z audio przez Matrix. Posłuchać jak brzmi 1:40 podcastu z gwarą. Jeśli OK → prod. Jeśli za słaba gwara → retunmy.

## Decyzja

- [ ] Akceptuję. Jedziemy E2E smoke z Matrix
- [ ] Wzmocnij gwarę (min. 3 markery/kw) i przetestuj jeszcze raz
- [ ] Próbuj wymusić 10 wymian (retry/prompt patch)
- [ ] Inne
