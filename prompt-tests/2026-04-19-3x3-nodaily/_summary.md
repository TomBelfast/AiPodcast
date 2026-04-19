# 3 modele × 3 podcasty — shootout na Rogan-prompt bez codzienności — 2026-04-19

## Setup
- **Prompt:** Rogan-style, bez wymogu codziennych elementów (Biedronka usunięta)
- **Content:** ten sam `../2026-04-18/content.md` (Claude 4.7 + Mythos)
- **Endpoint:** `POST /api/generate-podcast` real, TTS guard `omnivoice`
- **Estymacja czasu:** ~15 znaków/sekundę OmniVoice

## Zestawienie zbiorcze (średnie z 3 runów)

| Model | Cena vs Flash | # wymian | Avg długość | Czas [s] | Czas [min] | >160 zn | Gwara Antoni /kw | Gwara Zofia /kw | **W targecie 1.5-2.5 min** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Opus 4.7** | 10x | 9.0 | 121 zn | 73 | **1.21** ❌ | 0.3/kw ✅ | 1.2 | 2.0 | **0/3** ❌ |
| **Gemini 3.1 Pro** | 5x | 8.0 | 233 zn | 125 | **2.08** ✅ | **8/kw** ❌ | 1.7 | 1.6 | **3/3** ✅ |
| **Gemini 2.5 Flash** | 1x | 8.3 | 161 zn | 90 | **1.49** ⚠️ | 4/kw | 1.3 | 1.2 | **1/3** ⚠️ |

## Zestawienie szczegółowe per run

| Model | Run | # | Avg zn | Max | >160 | Total zn | Czas |
|---|---:|---:|---:|---:|---:|---:|---:|
| Opus 4.7 | 1 | 9 | 122 | 158 | 0 | 1102 | 1:13 |
| Opus 4.7 | 2 | 9 | 125 | 167 | 1 | 1129 | 1:15 |
| Opus 4.7 | 3 | 9 | 115 | 151 | 0 | 1038 | 1:09 |
| Gemini 3.1 Pro | 1 | 8 | 211 | 245 | 8 | 1689 | 1:53 |
| Gemini 3.1 Pro | 2 | 8 | 258 | 333 | 8 | 2067 | 2:18 |
| Gemini 3.1 Pro | 3 | 8 | 231 | 263 | 8 | 1850 | 2:03 |
| Gemini 2.5 Flash | 1 | 9 | 166 | 280 | 5 | 1494 | 1:40 |
| Gemini 2.5 Flash | 2 | 8 | 152 | 200 | 3 | 1218 | 1:21 |
| Gemini 2.5 Flash | 3 | 8 | 165 | 295 | 4 | 1323 | 1:28 |

## Kluczowe wnioski

### 1. Problem długości — ujawniony
Użytkownik chce **1.5-2.5 min**. Obecny prompt (Rogan, MAX 160 zn, 10-14 wymian):
- **Opus nie dowozi długości** — 1.2 min przez cały czas. Za krótki.
- **Gemini 3.1 Pro przedobrza** — hituje idealnie 2.0 min, ALE ŁAMIE limit 160 zn w 100% kwestii (avg 233 zn).
- **Gemini 2.5 Flash balansuje na granicy** — 1.5 min avg.

### 2. Charakterystyka modeli
- **Opus 4.7**: dyscyplina długości ✅, krótki ping-pong, ale za mało contentu per podcast. Najlepszy do snappy formatu, nie do 2-min.
- **Gemini 3.1 Pro**: gada długo i "za dużo", ale rytm naturalny, gwara silna, charakter najostrzejszy. Najlepszy do 2-min formatu, IGNORUJE ograniczenia długości zdania.
- **Gemini 2.5 Flash**: środek. Mix jakości — run 1 sensowny, run 2-3 słabsze. Akceptowalny za 10% ceny Opusa.

### 3. Efekt usunięcia wymogu codzienności
Żaden run nie wspomniał Biedronki/PKP/teściowej — to nigdy nie wychodziło i teraz nie wchodzi. Dialog bez forsy, naturalny. Dobry wybór strukturalny.

## Rekomendacje (2 ścieżki)

### Ścieżka A — Gemini 3.1 Pro jako prod
- ✅ Hituje długość 1.5-2.5 min out-of-the-box (3/3)
- ✅ Cena: 5x Flash (połowa Opusa)
- ✅ Mocne osobowości, pełne dialogi
- ⚠️ Musisz **odpuścić limit 160 zn** — Gemini Pro go nie respektuje. Ale dla 2-min formatu to nawet lepiej (mniej skoków, płynniej).
- **Akcja:** zmień w promptcie "MAX 160 zn" → "MAX 250 zn" + "10 wymian" (zamiast 10-14)

### Ścieżka B — Opus 4.7 + wydłużyć prompt
- ✅ Najczystsza dyscyplina, najmocniejsza gwara (Zofia run 2: 2.8 markery/kw)
- ❌ 1.2 min — za krótko. Trzeba forsować **14-18 wymian** w promptcie.
- ⚠️ Historycznie Opus ignoruje żądania liczby wymian (zawsze 9). Ryzyko że i 18 zignoruje.
- 💰 2x cena Gemini Pro

### Ścieżka C (moja rekomendacja) — **Gemini 3.1 Pro + prompt pod 2 min**
1. Przełącz prod na `google/gemini-3.1-pro-preview`
2. W promptcie: zmień limit na 220 zn, docelowo 10 wymian
3. E2E smoke z audio → ocena czy naturalnie brzmi
4. Oszczędzasz 50% vs Opus i hitjesz długość 3/3

**Dlaczego nie A bez zmian?** Bo teraz Gemini Pro produkuje zbyt długie zdania (>160) które w TTS będą ciężkie do słuchania. Wyregulowanie na 220 zn da lepszy rytm mimo że dalej nie Rogan.

## Twój wybór

- [ ] **A**: Gemini 3.1 Pro z obecnym promptem (ignoruj 160 zn)
- [ ] **B**: Opus + wydłużyć prompt do 14-18 wymian (ryzyko że model zignoruje)
- [ ] **C**: Gemini 3.1 Pro + prompt przeregulowany na 220 zn / 10 wymian (rekomendacja)
- [ ] **D**: Coś innego (np. Opus + content więcej — dłuższy input)
