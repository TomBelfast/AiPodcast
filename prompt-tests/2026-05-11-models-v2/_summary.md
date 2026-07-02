# Model shootout — 2026-05-11

## Setup

- **Content:** ten sam co `2026-04-19-models` → `../2026-04-18/content.md`
- **Prompt:** identyczny z produkcyjnym (TTS guard omnivoice plain + Rogan-style Antoni/Zofia + numbers-as-words)
- **Endpoint:** bezpośrednio OpenRouter `chat/completions` (skrypt `run.mjs`, bez restartu Next)
- **TTS:** NIE — tylko tekst

## Modele

- `google/gemini-3-flash-preview` — OK (6932 ms, 3036 tok)
- `google/gemini-3.1-flash-lite` — OK (5960 ms, 3072 tok)
- `deepseek/deepseek-v4-flash` — OK (19109 ms, 3090 tok)

## Wyniki (uzupełnij po przeczytaniu .md plików)

| Model | Avg | Śląska A | Góralska Z | Humor | Norm.ludzie | Osob. | Gram. | # linii |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `gemini-3-flash-preview` | __ | __ | __ | __ | __ | __ | __ | 10 |
| `gemini-3.1-flash-lite` | __ | __ | __ | __ | __ | __ | __ | 10 |
| `deepseek-v4-flash` | __ | __ | __ | __ | __ | __ | __ | 10 |
