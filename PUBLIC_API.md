# Public Podcast API

See also:

- [docs/podcast-video-flow.md](./docs/podcast-video-flow.md) for the full end-to-end product flow and UI walkthrough.

## Canonical Public Inputs

Public endpoints that create podcast conversation, audio, or video now prefer exactly one of:

```json
{
  "raw_text": "Source article or transcript text..."
}
```

or

```json
{
  "conversation": [
    { "speaker": "Antoni", "text": "..." },
    { "speaker": "Zofia", "text": "..." }
  ]
}
```

Sending both `raw_text` and `conversation` in the same public request returns `400`.

## Provider Shape

```json
{
  "language": "en",
  "tts": {
    "provider": "gemini",
    "voice1": "Charon",
    "voice2": "Kore",
    "model": "gemini-3.1-flash-tts-preview",
    "geminiStyle": "expressive-lite",
    "geminiTempo": "fast"
  },
  "avatar": {
    "provider": "soulx",
    "model": "pro"
  },
  "review": {
    "mode": "off"
  }
}
```

Supported public values today:

- top-level `language`: e.g. `pl`, `en`
- `tts.provider`: `gemini`, `elevenlabs`, `omnivoice`
- `tts.geminiStyle`: `expressive-lite`, `plain`
- `tts.geminiTempo`: `fast`, `normal`
- `avatar.provider`: `soulx`
- `review.mode`: `off`, `pause_after_conversation`

Current live Gemini defaults:

- `tts.model = gemini-3.1-flash-tts-preview`
- `tts.geminiStyle = expressive-lite`
- `tts.geminiTempo = fast`

Current live Gemini EN behavior:

- `POST /api/text-to-speech` now forwards top-level `language` into Gemini TTS director notes
- `language=en` no longer uses Polish-only performance instructions
- English delivery is biased toward natural English pronunciation with a subtle British-leaning prosody cue
- this is a prompt-level steering hint, not a hard provider guarantee of `en-GB`

## Route Notes

- `POST /api/generate-podcast`
  - Public input: `raw_text`
  - Always uses OpenRouter for LLM generation
  - Legacy aliases like `content`, `script_text`, and string `transcript` are still accepted

- `POST /api/text-to-speech`
  - Public input: `conversation`
  - Public provider config: `tts.provider`
  - Accepts top-level `language`; for `tts.provider=gemini` this changes the internal delivery prompt
  - Legacy `inputs` payloads are still accepted

- `POST /api/podcast-video/jobs`
  - Public input: `raw_text` or `conversation`
  - `tts.provider=omnivoice` is not supported in this workflow; use `podcast-film`

- `POST /api/podcast-video/podcast-film/jobs`
  - Public input: `raw_text` or `conversation`
  - Supports `tts.provider=gemini|elevenlabs|omnivoice`
  - `review.mode=pause_after_conversation` returns a generated conversation draft and the next-step payload instead of starting the render

## UI Preview Defaults

The `/podcast-video` page includes a `Podgląd stylu` tab for visual caption/title/header tuning.

- The preview saves browser-local defaults under `localStorage` key `ai-podcast-video-style-defaults`.
- The reset preset uses the current product header values: top `42`, bend `132`, arc width `450`.
- Title preview defaults to one word per line, centered in the image field, with auto-fit instead of clipping.
- These preview defaults are not yet a public API contract for MP4 rendering; renderer payload support should be added separately before external clients depend on these style fields.

## Legacy Compatibility

These fields are still mapped internally for compatibility, but are no longer the preferred public contract:

- `content`
- `script_text`
- string `transcript`
- `normalizedTranscript`
- `tts_engine`
- top-level `provider`
