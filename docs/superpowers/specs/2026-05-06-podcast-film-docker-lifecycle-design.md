# Podcast Film Docker Lifecycle Design

## Goal

Start the Windows Docker containers needed by podcast-film on demand, retry infrastructure failures up to three times by restarting those containers, and stop them after an idle period so RAM/VRAM is not held forever.

## Scope

This applies only to Workflow B podcast-film jobs. It controls existing containers through Docker Engine API at `http://127.0.0.1:2375` by default:

- `soulx-api`
- `omnivoice-omnivoice-podcast-api-1`

`omnivoice-omnivoice-ui-1` is not required for generation and stays optional through configuration.

## Runtime Flow

When a non-dry-run podcast-film job is accepted, the backend first asks Docker API to inspect the configured containers. Missing Docker API does not block existing behavior; the normal preflight checks still run and report the real worker failure if services are unavailable.

If Docker API is reachable, stopped containers are started and the backend waits for existing worker probes:

- Gemini or ElevenLabs jobs require OmniVoice assets plus SoulX.
- OmniVoice jobs require OmniVoice worker plus SoulX.

The background render runs under an infrastructure lease. The lease increments an in-process active-job counter and cancels any pending stop timer. When the job finishes or fails, the lease is released. If no other jobs are active, the backend schedules `docker stop` after an idle timeout, defaulting to ten minutes.

## Retry Policy

The backend retries the full background pipeline up to three retry attempts after the first failure. A retry is allowed only for infrastructure-shaped errors: Docker API failures, SoulX/OmniVoice connection failures, timeouts, HTTP 5xx, worker preflight failures, or worker generate failures. Input errors such as missing API keys, bad payloads, missing voices/images, or validation errors fail immediately.

Before each retry, Docker API restarts the configured containers and the backend waits for worker readiness again. Retries reuse the same job id and overwrite deterministic intermediate files in the job directory.

## Configuration

- `PODCAST_FILM_DOCKER_LIFECYCLE`: defaults to enabled; set `0` or `false` to disable.
- `PODCAST_FILM_DOCKER_API_BASE` or `DOCKER_API_BASE`: defaults to `http://127.0.0.1:2375`.
- `PODCAST_FILM_DOCKER_CONTAINERS`: comma-separated container names; defaults to `soulx-api,omnivoice-omnivoice-podcast-api-1`.
- `PODCAST_FILM_DOCKER_IDLE_STOP_MS`: defaults to `600000`.
- `PODCAST_FILM_INFRA_MAX_RETRIES`: defaults to `3`.

## Out Of Scope

The backend will not create containers, run `docker compose up`, expose Docker API, or manage Docker Desktop itself. If a container has been removed, the lifecycle reports that Docker can not start it.

## Verification

Unit-style script tests cover retry classification, max retry count, and idle stop scheduling. Runtime verification checks Docker `_ping`, filtered container status, SoulX health, OmniVoice health, TypeScript, and production build.
