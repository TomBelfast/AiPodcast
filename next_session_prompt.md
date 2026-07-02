Continue in `/root/AiPodcast`.

Start by reading:

- `task_plan.md`
- `findings.md`
- `progress.md`
- `TODO.md`

Current product state:

- `/podcast-video` has a permanent `Generator` tab and a permanent `Podgląd stylu` tab.
- `Podgląd stylu` is implemented in `src/components/podcast-video/PodcastStylePreview.tsx`.
- The style preview defaults are saved in browser `localStorage` under `ai-podcast-video-style-defaults`.
- Current reset preset:
  - header text: `AI W BIZNESIE PL`
  - header top: `42`
  - header bend: `132`
  - header arc width: `450`
  - title: each word on a new line
  - title: centered vertically and horizontally in the image field
  - title: auto-fit instead of clipping when margins are tight
- `public/subtitle-font-preview.html` remains only as the visual source/reference.
- `public/podcast-page-preview.html` was removed because the React tab replaced that static prototype.

Current Gemini state:

- Keep model `gemini-3.1-flash-tts-preview`.
- Live defaults remain `geminiStyle=expressive-lite` and `geminiTempo=fast`.
- Full MP4 technical smokes have passed, but a human Polish listening pass is still pending.

Good next steps:

1. If product work continues, extend the backend renderer contract so MP4 title/header burn-in can use the saved preview style.
2. If cleanup continues, tackle remaining pre-existing ESLint errors in active TypeScript routes and keep deleting only proven one-off scripts.
3. If QA continues, listen to the archived full MP4 artifacts before changing Gemini prompts.
