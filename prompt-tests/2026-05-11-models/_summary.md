# Model shootout — 2026-05-11

## Setup

- **Content:** ten sam co `2026-04-19-models` → `../2026-04-18/content.md`
- **Prompt:** identyczny z produkcyjnym endpointem `/api/generate-podcast` (TTS guard omnivoice plain + Rogan-style Antoni/Zofia + numbers-as-words)
- **Endpoint:** bezpośrednio OpenRouter `chat/completions` (skrypt `run.mjs`, bez restartu Next)
- **TTS:** NIE — tylko tekst
- **Temperature:** 0.8, 1 próbka na model
- **JSON mode:** włączony, retry bez JSON mode jeśli provider odrzuca (tencent)

## Wyniki techniczne

| Model | Status | Latency | Linie | Znaków |
|---|---|---:|---:|---:|
| `google/gemini-3.1-flash-lite` | OK | 4.0 s | 10 | 1273 |
| `tencent/hy3-preview` | OK (no JSON mode — retry) | 68.3 s | 10 | 1765 |
| `deepseek/deepseek-v4-flash` | OK | 14.1 s | 10 | 708 |
| `deepseek/deepseek-v4-pro` | OK | 60.4 s | 8 | 726 |

Uwagi:
- `tencent/hy3-preview` na OpenRouter nie wspiera trybu JSON (`code 20024 — Json mode is not supported`) — skrypt wykonał retry bez `response_format`, odpowiedź sparsowana poprawnie.
- `deepseek-v4-pro` zwrócił tylko 8 linii (poniżej twardego wymogu 10 z promptu).
- `deepseek-v4-flash` ma 10 linii, ale tekst całościowy (708 zn) jest grubo poniżej dolnego limitu 1600 zn z promptu.
- `hy3-preview` najbliżej limitu długościowego (1765 zn) i jako jedyny mieści się w przedziale 1600-2200.

## Twoja ocena (uzupełnij po przeczytaniu .md plików)

| Model | Avg | Śląska A | Góralska Z | Humor | Norm.ludzie | Osob. | Gram. |
|---|---:|---:|---:|---:|---:|---:|---:|
| `gemini-3.1-flash-lite` | __ | __ | __ | __ | __ | __ | __ |
| `hy3-preview` | __ | __ | __ | __ | __ | __ | __ |
| `deepseek-v4-flash` | __ | __ | __ | __ | __ | __ | __ |
| `deepseek-v4-pro` | __ | __ | __ | __ | __ | __ | __ |

**Wybór:** _______
