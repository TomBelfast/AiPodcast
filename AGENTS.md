# Repository Guidelines

## Project Structure & Module Organization

This is a Next.js 15 App Router project. Pages and API routes live in `src/app`; main UI screens include `src/app/page.tsx` and `src/app/podcast-video/page.tsx`. Shared UI components live in `src/components`, server actions in `src/actions`, common types in `src/types`, and domain logic in `src/lib`.

Podcast video orchestration is in `src/lib/podcast-video`; podcast generation contracts and helpers are in `src/lib/podcast`. Operational docs are in `docs/`, API notes are in `PUBLIC_API.md` and `WEBHOOK_API.md`, migrations are in `supabase/migrations`, and one-off verification tools live in `scripts/`.

Key docs:
- `WEBHOOK_API.md` — webhook endpoints, status polling, callback push
- `PUBLIC_API.md` — canonical public API shape and provider config
- `docs/matrix-integration.md` — integracja z SocialMedia/Matrix: architektura, fazy generowania, mechanizm callback push, zmienne środowiskowe
- `docs/podcast-video-flow.md` — pełny przepływ generowania wideo end-to-end

## Build, Test, and Development Commands

- `npm run dev` starts the local Next.js server on port `3300`.
- `npm run build` creates a production build. Do not rely on it alone because `next.config.ts` ignores build-time TypeScript and ESLint failures.
- `npm run start` serves the built app on port `3300`.
- `npm run lint` runs ESLint with `next/core-web-vitals` and `next/typescript`.
- `npm run smoke:gemini-tts` checks live Gemini TTS integration.
- `npm run smoke:podcast-film:gemini` runs the podcast-film Gemini smoke path.

Smoke scripts may require local secrets, worker services, MinIO, or Supabase configuration.

## Coding Style & Naming Conventions

Use TypeScript and keep `strict` compatibility. Follow existing formatting: 2-space indentation, semicolons, named exports for shared helpers, PascalCase React components, camelCase functions, and kebab-case route or script names. Use the `@/*` alias for imports from `src`.

Keep route handlers explicit about runtime when they use Node APIs, for example `export const runtime = 'nodejs';`. Do not commit generated media, `.env*`, or `.admin_settings.json`.

## Testing Guidelines

There is no formal unit-test runner configured. For most changes, run `npm run lint` and `npx tsc --noEmit`; for runtime-sensitive changes, add or run a targeted script under `scripts/`. Name new checks after the behavior they validate, such as `scripts/test-audio-splitter.ts`.

Write temporary outputs to ignored locations such as `test-output/` or `archive/`.

## Commit & Pull Request Guidelines

History uses a mix of Conventional Commits and concise descriptive subjects, for example `feat(pipeline-b): ...`, `fix: ...`, and short Polish/English summaries. Prefer `type(scope): summary` when the scope is clear.

Pull requests should describe the user-visible change, list verification commands, call out required environment variables or external services, and include screenshots or artifact links for UI or video-output changes.

## Security & Configuration Tips

Keep secrets in `.env.local` or service-level configuration. Never hard-code API keys in routes, scripts, or docs. When adding API responses, sanitize provider credentials before returning request metadata to clients.
