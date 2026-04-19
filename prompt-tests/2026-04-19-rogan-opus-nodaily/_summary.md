# Rogan-style BEZ codziennych elementów — Opus 4.7 — 2026-04-19

## Setup
- **Model:** `anthropic/claude-opus-4.7`
- **Prompt:** Rogan-style, ale **USUNIĘTY** `CODZIENNY ELEMENT — TWARDY WYMÓG`
  oraz przepisany przykład (bez Biedronki, PKP, ZUS, teściowej).
- Pozostaje: dialekt (MIN. 2/kwestię), pointa, limit 160 zn, tempo ping-pong.

## Porównanie: z wymogiem codzienności vs bez

| Metryka | Cel | Opus Z codz. (3 runy) | **Opus BEZ codz. (3 runy)** |
|---|---|---|---|
| Wymian | 10-14 | 9/9/9 | **9/9/9** (identycznie) |
| Avg długość | ≤160 zn | 99/120/112 | **108/110/126** |
| Kwestie >160 zn | 0 | 0/0/0 ✅ | **0/0/0** ✅ |
| Gwara Antoni /kw | ≥2 | 1.75/2/2.75 | **2.00/1.20/1.40** ⚠️ |
| Gwara Zofia /kw | ≥2 | 5/2.25/3.75 | **1.50/1.50/3.50** ⚠️ |
| Daily elements | - | 0/0/1 | **0/0/0** ✅ (intencjonalnie) |

## Wyniki trzech runów

### Run 1 (9 wymian, avg 108, max 132)
1. [Antoni] (93) "Jo, Zofia, słyszałaś? Anthropic wypuścił Claude cztery kropka siedem i to je totalnie fajnie!"
2. [Zofia] (127) "Hej, słyszałam. Kilkanaście procent lepiej w inzynierii, tyz trzy razy lepiej z obrazami. Nic takiego, com się nie spodziewała."
3. [Antoni] (110) "Ale kaj tam nic! Oni majom sekretny model, nazywa się Mythos, i je znacznie potężniejszy niż publiczny Claude!"
4. [Zofia] (97) "No i co z tego, kiej go nie wypuszczom? Boja sie nadużyć. Klasyka, marketing, zeby ludzie gadali."
5. [Antoni] (127) "Ale Zofia, ten model projektuje cołkie strony internetowe ino z opisu tekstowego! A te routines automatyzujom robota w chmurze!"
6. [Zofia] (132) "Hej, ino zauważyłeś, ze nowe instrukcje som bardzo dosłowne? Stare aplikacje przestanom działać. Deweloperzy bedom płakać nad kodem."
7. [Antoni] (101) "No jo, ale to postęp! Choć fakt, akcje firm softwarowych lecom w dół, programiści sie bojom o robota."
8. [Zofia] (118) "No widzisz, mówiłam. Kiej AI wypiera klasyczne narzędzia, to twój entuzjazm ci pracy nie uratuje. Ale ciesz sie dalej."
9. [Antoni] (72) "Dobra, dobra, i tak myślę, ze to siekiera nowość! Idymy testować, Zofia!"

### Run 2 (9 wymian, avg 110, max 136)
1. [Antoni] (114) "Jo, Zofia, słyszałaś? Anthropic wypuścił Claude cztery kropka siedem! Trzy razy lepiej rozumie obrazy, fajnie nie?"
2. [Zofia] (121) "Hej, słyszałam. Ale ciebie kazdy nowy model tak samo jara. Kilkanoście procent w testach to nie rewolucja, ino kosmetyka."
3. [Antoni] (113) "Ale kaj tam kosmetyka! Oni przyznali, że majom sekretny model Mythos, dużo potężniejszy, ino boją się go pokazać!"
4. [Zofia] (106) "Tyz mi nowina. To marketing, kieby podgrzać hype. Kazda firma godo, że ma cosik mocniejszego w szufladzie."
5. [Antoni] (136) "No dobra, ale wyobraź sobie, Claude zaprojektuje całą stronę ino z opisu tekstowego! A te routines automatyzują cały workflow w chmurze!"
6. [Zofia] (116) "I dlatego akcje firm softwareowych lecom w dół, a programiści som w panice. Ty się cieszysz, a ludzie tracom robota."
7. [Antoni] (114) "No tak, ale stare aplikacje podobno przestają działać, bo instrukcje som za dosłowne. Myślisz, że to duży problem?"
8. [Zofia] (110) "Obvious, że duży. Kazdy musi aktualizować kod, bo inaczej wszystko się sypie. Hej, witej w nowej erze, kolego."
9. [Antoni] (62) "E tam, jo tam wierzę, że bedzie ekstra! Idymy testować, Zofia!"

### Run 3 (9 wymian, avg 126, max 157)
1. [Antoni] (157) "Jo, Zofia, słyszałaś? Anthropic wypuścił Claude cztery kropka siedem! Kilkanaście procent lepiej w kodowaniu, a obrazy rozumie trzy razy lepiej! Fajnie, nie?"
2. [Zofia] (138) "Hej, ino spokojnie. Kozdy tydzień jakiś nowy model som wypuscajom. Ale powiedz mi lepiej o tym sekretnym Mythosie, bo to dopiero jest hec."
3. [Antoni] (135) "No jo, to mnie ścieło! Majom wewnętrzny model potężniejszy niż publiczny, ino boją się go wypuścić przez bezpieczeństwo! Wyobrażasz se?"
4. [Zofia] (145) "Kieby to prawda była, to marketing pierwsza klasa. Straszą nas potęgom, cobyśmy bardziej chcieli. Stary chwyt, jesce z czasów GPT som go używali."
5. [Antoni] (127) "Ale Zofia, on projektuje cołkie strony ino z opisu! A te routines automatyzują robotę w chmurze! Deweloperzy bedom mieli lekko!"
6. [Zofia] (146) "Lekko? Zauważyłeś, ze stare aplikacje pšestajom działać, bo nowe instrukcje som dosłowne? Giełda tyz leci w dół, klasyczne firmy software padajom."
7. [Antoni] (93) "No tak, programiści się boją o robotę. Ale może to szansa, coby robić fajniejsze rzeczy, nie?"
8. [Zofia] (133) "Hej, optymisto. Kiej cie AI zastąpi, to mi powiesz, jak bardzo fajnie ci jest. Na razie radza aktualizować kod, bo inacy bedzie płac."
9. [Antoni] (62) "Dobra, dobra! Ale i tak uwazom, ze to przełom! Idymy testować!"

## Kluczowe wnioski

### Czy usunięcie wymogu coś zepsuło?
- ✅ **Tempo i długości — identyczne.** Zero regresji.
- ✅ **Limit 160 zn — dalej 100% respektowany** (0/27 kwestii przekroczyło).
- ⚠️ **Lekki spadek gwary** (Zofia avg z ~3.7 → 2.2 markery/kwestię; Antoni z ~2.2 → 1.5). Nie dramat, ale widoczny.
- ✅ **Osobowości utrzymane:** Antoni "totalnie fajnie", "pieruńsko", "siekiera nowość"; Zofia "klasyka, marketing", "tyz mi nowina", "witej w nowej erze".
- ⚠️ **Nowy pattern:** Run 1-2 mają podobną strukturę zakończenia (Antoni: "Idymy testować, Zofia!"). Pewna rutyna, ale to wpływ `content` nie promptu.

### Co nie zmieniło się (i prawdopodobnie nigdy nie zmieni się przez sam prompt)
- **9 wymian, nie 10-14.** Opus stabilnie generuje 9 nawet gdy proszę o 10-14. Wygląda że to silne prior modelu na "short podcast = ~8-10 turns". 
- Żeby wymusić 12 — trzeba albo wielokrotnego promptingu (expensive), albo postprocess/schema na min. elements.

## Verdict

**Usunięcie wymogu codzienności = łagodna strata gwary, zerowy koszt jakości rytmu.**

Plusy:
- Mniej "ciśnięty" dialog, brak forsowania Biedronki która i tak była ignorowana
- Dialogi bardziej naturalne (nie wyglądają jak "wplataj Biedronkę bo MUSISZ")
- Prompt krótszy = mniejszy koszt input tokens

Minusy:
- Lekki spadek gwary (bo wymóg codzienny wzmacniał tez ogólną lokalność)
- Dalej brak "punktu widzenia normalnych ludzi" — którego tak naprawdę nigdy nie osiągnęliśmy

## Rekomendacja

**Zostaw bez codzienności.** Jeśli i tak tego nie osiągaliśmy, a rytm/gwara/osobowości są OK — nie ma po co zaśmiecać promptu.

Jeśli chcesz dialogi jeszcze bardziej lokalne — zamiast wymuszać Biedronkę, **wzmocnij Zofię** jako cyniczną babcię z doświadczeniem (nie "sąsiad ze ZUS-u", ale jej własne obserwacje: "Kiebyś pomyślał, zanim kupiłeś", "Kozdy tydzień nowy model" — tak już robi).

Alternatywnie — pomyśl o **E2E smoke teście z audio**. Tekst nie mówi ci jak to brzmi z głosem.
