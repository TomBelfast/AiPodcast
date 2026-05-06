# Podcast Film Docker Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add on-demand Docker lifecycle, idle stop, and up to three infrastructure retries to Workflow B podcast-film rendering.

**Architecture:** Create a focused Docker lifecycle helper in `src/lib/podcast-video/docker-lifecycle.ts`, keep route-specific readiness probes in `src/app/api/podcast-video/podcast-film/jobs/route.ts`, and add a Node smoke/unit script for pure retry/lifecycle policy checks.

**Tech Stack:** Next.js route handlers, Node fetch/Docker Engine API, TypeScript, script-based Node assertions.

---

### Task 1: Lifecycle Helper

**Files:**
- Create: `src/lib/podcast-video/docker-lifecycle.ts`
- Create: `scripts/test-podcast-film-docker-lifecycle.js`

- [ ] Add script tests that assert infra error classification, max retry count of three, and idle stop scheduling.
- [ ] Run `node scripts/test-podcast-film-docker-lifecycle.js` and verify it fails because the helper does not exist.
- [ ] Implement Docker API helper with start, restart, lease release, and idle stop timer.
- [ ] Run the script again and verify it passes.

### Task 2: Route Integration

**Files:**
- Modify: `src/app/api/podcast-video/podcast-film/jobs/route.ts`

- [ ] Import the lifecycle helper.
- [ ] Start containers before non-dry-run preflight.
- [ ] Replace single background run with retry loop.
- [ ] Restart containers and re-run readiness probes before each infrastructure retry.
- [ ] Release the lifecycle lease in `finally`.

### Task 3: Verification

**Files:**
- No new files.

- [ ] Run `node scripts/test-podcast-film-docker-lifecycle.js`.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npm run build`.
- [ ] Verify Docker API `_ping` on `http://127.0.0.1:2375/_ping`.
- [ ] Verify SoulX and OmniVoice health endpoints.
