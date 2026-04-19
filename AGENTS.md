# AGENTS — AiPodcast project memory

Keep this file small. Store only durable facts and high-signal working conventions.

## Durable facts

- This repo is the orchestrator for podcast video generation on `.54`.
- The active working plan for Pipeline B lives in [`TODO.md`](./TODO.md) in this repo.
- Pipeline A (`/api/podcast-video/jobs`) is the existing Static Video flow and must remain working.
- Pipeline B (`/api/podcast-video/podcast-film/jobs`) already exists in this repo and currently does:
  - parse transcript / conversation into segments
  - fetch OmniVoice voice registry from `.13:8766 /voices`
  - call `.13:8766 /api/v1/podcast-film/jobs`
  - call SoulX `.13:7000 /generate` per segment
  - concat MP4 segments with hard cut by default
  - generate `captions.srt`
  - burn word-level ASS highlight captions into final MP4
- Current Pipeline B caption logic uses:
  - original segment text as subtitle text
  - Whisper word timestamps only for timing reconciliation
  - `caption_matched_words` / `caption_unmatched_words` as response diagnostics
  - it preserves dialect wording and does not use Whisper output as subtitle text
- Live smoke on 2026-04-18 produced correct original-text SRT with `caption_matched_words = 41` and `caption_unmatched_words = 2`.
- OmniVoice voice registry is folder-based in `C:\APLIKACJE\OmniVoice\personalized-podcast\voice_samples\`.
- Current worker base URLs on `.13`: OmniVoice `http://192.168.0.13:8766`, SoulX `http://192.168.0.13:7002` (moved from `:7000` on 2026-04-19).
- Production LLM for Polish podcast generation: `google/gemini-3.1-pro-preview` via OpenRouter (hits 1.5-2.5 min target out-of-the-box, 50% cost of Opus 4.7). Prompt: `defaultHostPersonalitiesPolish` v8 (Rogan-style, MAX 220 zn, 10 wymian, dialekt Śląsk+Góralski, bez wymogu codziennych elementów).
- SoulX default model: `pro` (since 2026-04-19), override `lite` per job if needed.
- Historical compatibility mapping must stay:
  - `host_a` -> `obea`
  - `host_b` -> `okarlik2`
- 9:16 branded cover overlay is live on `.54`; current final output is `1080x1920`.

## Preferences

- Prefer updating `TODO.md` here when Pipeline B status changes, because `.54` is the working orchestrator and the user switches tools often.
- Do not re-implement Pipeline B from scratch; inspect the current `.54` route first and extend it incrementally.
