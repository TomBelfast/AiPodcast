# Prod-endpoint shootout — 2026-05-11 v2-prod

## Setup
- **Endpoint:** `http://localhost:3300/api/generate-podcast` (Next dev server, hot-reloaded source)
- **Prompt:** z `src/app/api/generate-podcast/route.ts` po patchu v2 (1700-2100 zn, 10 wymian, 150-220 zn/linia, bez `siekiery`)
- **TTS provider:** omnivoice (uruchamia plain-speech guard, jak w v2 standalone)
- **Cel:** potwierdzenie że patch faktycznie żyje w prod-pipeline i daje takie same wyniki co standalone

## Wyniki

| Model | Status | Latency | Linie | Znaków | per-line in 150-220 |
|---|---|---:|---:|---:|---:|
| `google/gemini-3-flash-preview` | OK | 7546 ms | 10 | 2001 | 10/10 |
| `google/gemini-3.1-flash-lite` | OK | 4937 ms | 10 | 2047 | 10/10 |
| `deepseek/deepseek-v4-flash` | OK | 102234 ms | 10 | 1790 | 10/10 |
