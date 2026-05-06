type TimerHandle = ReturnType<typeof setTimeout>;

export type PodcastFilmDockerLifecycleConfig = {
  enabled: boolean;
  dockerApiBase: string;
  containers: string[];
  idleStopMs: number;
  requestTimeoutMs: number;
  stopTimeoutSeconds: number;
};

export type PodcastFilmDockerActionResult = {
  enabled: boolean;
  dockerAvailable: boolean;
  ok: boolean;
  action: 'start' | 'restart' | 'stop' | 'ping';
  containers: string[];
  detail: string;
};

export type PodcastFilmDockerLease = {
  release: () => void;
};

type RetryContext = {
  attempt: number;
  nextAttempt: number;
  maxRetries: number;
  error: unknown;
};

type RetryOperationContext = {
  attempt: number;
};

type IdleStopControllerOptions = {
  idleStopMs: number;
  stopContainers: () => Promise<void>;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
};

const DEFAULT_DOCKER_API_BASE = 'http://127.0.0.1:2375';
const DEFAULT_DOCKER_CONTAINERS = [
  'soulx-api',
  'omnivoice-omnivoice-podcast-api-1',
];
const DEFAULT_IDLE_STOP_MS = 10 * 60 * 1000;
const DEFAULT_DOCKER_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_DOCKER_STOP_TIMEOUT_SECONDS = 10;
const RETRYABLE_STATUS_PATTERN = /\b50[0-9]\b|\b502\b|\b503\b|\b504\b/;
const LOCAL_WORKER_PATTERN =
  /soulx|omnivoice|docker|container|worker preflight|192\.168\.0\.13:(8766|7002)|127\.0\.0\.1:2375/i;
const RETRY_SIGNAL_PATTERN =
  /timeout|timed out|econnrefused|econnreset|etimedout|socket hang up|fetch failed|failed to reach|health request failed|voices request failed|images\([^)]*\) request failed|worker preflight failed|docker api|connect timeout|terminated/i;
const NON_RETRYABLE_INPUT_PATTERN =
  /api key is not configured|missing_gemini_key|missing_elevenlabs_key|request must include|pinned image|not in folder|validation|bad payload|dry-run failed/i;

const globalForPodcastFilmDocker = globalThis as typeof globalThis & {
  __podcastFilmDockerIdleStopController?: ReturnType<typeof createPodcastFilmDockerIdleStopController>;
};

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  return fallback;
}

function parseNumberEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeDockerApiBase(value: string | undefined): string {
  const raw = (value || DEFAULT_DOCKER_API_BASE).trim();
  return raw.replace(/\/+$/, '');
}

function parseContainerList(value: string | undefined): string[] {
  const containers = (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return containers.length > 0 ? containers : DEFAULT_DOCKER_CONTAINERS;
}

function flattenErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return cause
      ? `${error.message} | cause=${flattenErrorMessage(cause)}`
      : error.message;
  }
  return String(error);
}

export function getPodcastFilmDockerLifecycleConfig(
  env: NodeJS.ProcessEnv = process.env
): PodcastFilmDockerLifecycleConfig {
  return {
    enabled: parseBooleanEnv(env.PODCAST_FILM_DOCKER_LIFECYCLE, true),
    dockerApiBase: normalizeDockerApiBase(env.PODCAST_FILM_DOCKER_API_BASE || env.DOCKER_API_BASE),
    containers: parseContainerList(env.PODCAST_FILM_DOCKER_CONTAINERS),
    idleStopMs: parseNumberEnv(
      env.PODCAST_FILM_DOCKER_IDLE_STOP_MS,
      DEFAULT_IDLE_STOP_MS,
      0,
      60 * 60 * 1000
    ),
    requestTimeoutMs: parseNumberEnv(
      env.PODCAST_FILM_DOCKER_REQUEST_TIMEOUT_MS,
      DEFAULT_DOCKER_REQUEST_TIMEOUT_MS,
      500,
      60 * 1000
    ),
    stopTimeoutSeconds: parseNumberEnv(
      env.PODCAST_FILM_DOCKER_STOP_TIMEOUT_SECONDS,
      DEFAULT_DOCKER_STOP_TIMEOUT_SECONDS,
      1,
      120
    ),
  };
}

export function getPodcastFilmInfrastructureMaxRetries(
  env: NodeJS.ProcessEnv = process.env
): number {
  return parseNumberEnv(env.PODCAST_FILM_INFRA_MAX_RETRIES, 3, 0, 10);
}

export function isRetryablePodcastFilmInfrastructureError(error: unknown): boolean {
  const text = flattenErrorMessage(error);
  if (!text || NON_RETRYABLE_INPUT_PATTERN.test(text)) {
    return false;
  }
  return (
    LOCAL_WORKER_PATTERN.test(text) &&
    (RETRY_SIGNAL_PATTERN.test(text) || RETRYABLE_STATUS_PATTERN.test(text))
  );
}

async function dockerRequest(
  config: PodcastFilmDockerLifecycleConfig,
  endpoint: string,
  init: RequestInit = {}
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${config.dockerApiBase}${endpoint}`, {
    ...init,
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  const text = await response.text().catch(() => '');
  return { status: response.status, text };
}

async function pingDockerApi(
  config: PodcastFilmDockerLifecycleConfig
): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await dockerRequest(config, '/_ping', { method: 'GET' });
    const ok = response.status === 200 && response.text.trim() === 'OK';
    return {
      ok,
      detail: ok ? 'Docker API reachable' : `Docker API ping returned HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: `Docker API ping failed: ${flattenErrorMessage(error)}`,
    };
  }
}

async function inspectContainer(
  config: PodcastFilmDockerLifecycleConfig,
  containerName: string
): Promise<{ exists: boolean; running: boolean; detail: string }> {
  const endpoint = `/containers/${encodeURIComponent(containerName)}/json`;
  const response = await dockerRequest(config, endpoint, { method: 'GET' });
  if (response.status === 404) {
    return { exists: false, running: false, detail: `${containerName} not found` };
  }
  if (response.status !== 200) {
    return {
      exists: false,
      running: false,
      detail: `${containerName} inspect returned HTTP ${response.status}`,
    };
  }
  const parsed = JSON.parse(response.text) as { State?: { Running?: boolean } };
  return {
    exists: true,
    running: parsed.State?.Running === true,
    detail: `${containerName} ${parsed.State?.Running === true ? 'running' : 'stopped'}`,
  };
}

async function postContainerAction(
  config: PodcastFilmDockerLifecycleConfig,
  containerName: string,
  action: 'start' | 'restart' | 'stop'
): Promise<{ ok: boolean; detail: string }> {
  const timeoutQuery =
    action === 'start' ? '' : `?t=${encodeURIComponent(String(config.stopTimeoutSeconds))}`;
  const endpoint = `/containers/${encodeURIComponent(containerName)}/${action}${timeoutQuery}`;
  try {
    const response = await dockerRequest(config, endpoint, { method: 'POST' });
    if ([204, 304].includes(response.status)) {
      return { ok: true, detail: `${containerName} ${action} accepted` };
    }
    return {
      ok: false,
      detail: `${containerName} ${action} returned HTTP ${response.status}: ${response.text.slice(0, 180)}`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: `${containerName} ${action} failed: ${flattenErrorMessage(error)}`,
    };
  }
}

function disabledResult(action: PodcastFilmDockerActionResult['action']): PodcastFilmDockerActionResult {
  return {
    enabled: false,
    dockerAvailable: false,
    ok: true,
    action,
    containers: [],
    detail: 'Docker lifecycle disabled',
  };
}

export async function ensurePodcastFilmDockerContainersStarted(
  config = getPodcastFilmDockerLifecycleConfig()
): Promise<PodcastFilmDockerActionResult> {
  if (!config.enabled) {
    return disabledResult('start');
  }

  const ping = await pingDockerApi(config);
  if (!ping.ok) {
    return {
      enabled: true,
      dockerAvailable: false,
      ok: false,
      action: 'start',
      containers: config.containers,
      detail: ping.detail,
    };
  }

  const details: string[] = [];
  let ok = true;
  for (const container of config.containers) {
    try {
      const inspected = await inspectContainer(config, container);
      details.push(inspected.detail);
      if (!inspected.exists) {
        ok = false;
        continue;
      }
      if (!inspected.running) {
        const started = await postContainerAction(config, container, 'start');
        details.push(started.detail);
        ok = ok && started.ok;
      }
    } catch (error) {
      ok = false;
      details.push(`${container} start check failed: ${flattenErrorMessage(error)}`);
    }
  }

  return {
    enabled: true,
    dockerAvailable: true,
    ok,
    action: 'start',
    containers: config.containers,
    detail: details.join(' | '),
  };
}

export async function restartPodcastFilmDockerContainers(
  config = getPodcastFilmDockerLifecycleConfig()
): Promise<PodcastFilmDockerActionResult> {
  if (!config.enabled) {
    return disabledResult('restart');
  }

  const ping = await pingDockerApi(config);
  if (!ping.ok) {
    return {
      enabled: true,
      dockerAvailable: false,
      ok: false,
      action: 'restart',
      containers: config.containers,
      detail: ping.detail,
    };
  }

  const results = await Promise.all(
    config.containers.map((container) => postContainerAction(config, container, 'restart'))
  );
  return {
    enabled: true,
    dockerAvailable: true,
    ok: results.every((result) => result.ok),
    action: 'restart',
    containers: config.containers,
    detail: results.map((result) => result.detail).join(' | '),
  };
}

export async function stopPodcastFilmDockerContainers(
  config = getPodcastFilmDockerLifecycleConfig()
): Promise<PodcastFilmDockerActionResult> {
  if (!config.enabled) {
    return disabledResult('stop');
  }

  const ping = await pingDockerApi(config);
  if (!ping.ok) {
    return {
      enabled: true,
      dockerAvailable: false,
      ok: false,
      action: 'stop',
      containers: config.containers,
      detail: ping.detail,
    };
  }

  const results = await Promise.all(
    config.containers.map((container) => postContainerAction(config, container, 'stop'))
  );
  return {
    enabled: true,
    dockerAvailable: true,
    ok: results.every((result) => result.ok),
    action: 'stop',
    containers: config.containers,
    detail: results.map((result) => result.detail).join(' | '),
  };
}

export function createPodcastFilmDockerIdleStopController(options: IdleStopControllerOptions) {
  let activeLeases = 0;
  let pendingTimer: TimerHandle | null = null;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;

  const clearPendingStop = () => {
    if (pendingTimer) {
      clearTimer(pendingTimer);
      pendingTimer = null;
    }
  };

  const scheduleStopIfIdle = () => {
    clearPendingStop();
    if (activeLeases > 0 || options.idleStopMs < 0) {
      return;
    }
    pendingTimer = setTimer(() => {
      pendingTimer = null;
      if (activeLeases > 0) {
        return;
      }
      void options.stopContainers().catch((error) => {
        console.error('[podcast-film] Docker idle stop failed:', error);
      });
    }, options.idleStopMs);
  };

  return {
    acquire(): PodcastFilmDockerLease {
      let released = false;
      activeLeases += 1;
      clearPendingStop();
      return {
        release() {
          if (released) {
            return;
          }
          released = true;
          activeLeases = Math.max(0, activeLeases - 1);
          scheduleStopIfIdle();
        },
      };
    },
    getActiveLeases() {
      return activeLeases;
    },
    cancelPendingStop: clearPendingStop,
  };
}

function getGlobalIdleStopController() {
  if (!globalForPodcastFilmDocker.__podcastFilmDockerIdleStopController) {
    const config = getPodcastFilmDockerLifecycleConfig();
    globalForPodcastFilmDocker.__podcastFilmDockerIdleStopController =
      createPodcastFilmDockerIdleStopController({
        idleStopMs: config.idleStopMs,
        stopContainers: async () => {
          const result = await stopPodcastFilmDockerContainers();
          if (!result.ok) {
            console.warn(`[podcast-film] Docker idle stop incomplete: ${result.detail}`);
          }
        },
      });
  }
  return globalForPodcastFilmDocker.__podcastFilmDockerIdleStopController;
}

export function acquirePodcastFilmDockerLease(): PodcastFilmDockerLease {
  return getGlobalIdleStopController().acquire();
}

export async function runWithPodcastFilmInfrastructureRetries<T>(args: {
  maxRetries?: number;
  operation: (context: RetryOperationContext) => Promise<T>;
  restartInfrastructure: (context: RetryContext) => Promise<void>;
  ensureReady: (context: RetryContext) => Promise<void>;
  onRetry?: (context: RetryContext) => Promise<void> | void;
  isRetryable?: (error: unknown) => boolean;
}): Promise<T> {
  const maxRetries = Math.max(0, Math.floor(args.maxRetries ?? 3));
  const isRetryable = args.isRetryable || isRetryablePodcastFilmInfrastructureError;
  let attempt = 0;

  while (true) {
    try {
      return await args.operation({ attempt });
    } catch (error) {
      if (attempt >= maxRetries || !isRetryable(error)) {
        throw error;
      }
      const context: RetryContext = {
        attempt,
        nextAttempt: attempt + 1,
        maxRetries,
        error,
      };
      await args.onRetry?.(context);
      await args.restartInfrastructure(context);
      await args.ensureReady(context);
      attempt += 1;
    }
  }
}
