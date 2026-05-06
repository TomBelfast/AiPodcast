import { promises as fs } from 'fs';
import {
  PODCAST_VIDEO_ARCHIVE_DIR,
  getPodcastVideoJobPaths,
  ensurePodcastVideoArchiveDir,
} from './archive';

export type JobPhaseId =
  | 'generate_podcast'
  | 'fetch_voices_images'
  | 'omnivoice_tts'
  | 'soulx_talkhead'
  | 'concat'
  | 'whisper_align'
  | 'burn_subs';

export const JOB_PHASES: JobPhaseId[] = [
  'generate_podcast',
  'fetch_voices_images',
  'omnivoice_tts',
  'soulx_talkhead',
  'concat',
  'whisper_align',
  'burn_subs',
];

export type JobState = 'queued' | 'running' | 'done' | 'failed';

export interface JobStatus {
  job_id: string;
  phase: JobPhaseId | null;
  phase_index: number;
  phase_total: number;
  percent: number;
  state: JobState;
  message: string;
  started_at: string;
  updated_at: string;
  phase_progress?: { current: number; total: number } | null;
  result: unknown | null;
  error: { phase: JobPhaseId | null; code?: string; detail: string } | null;
}

const PROCESS_STARTED_AT_MS = Date.now() - Math.floor(process.uptime() * 1000);
const INTERRUPTED_JOB_RECOVERY_GRACE_MS = 1500;
const RECOVERY_SWEEP_MIN_INTERVAL_MS = 5000;
const DEFAULT_RUNNING_JOB_STALE_TIMEOUT_MS = 30 * 60 * 1000;

const RUNNING_JOB_STALE_TIMEOUT_MS: Record<JobPhaseId, number> = {
  generate_podcast: 10 * 60 * 1000,
  fetch_voices_images: 5 * 60 * 1000,
  omnivoice_tts: 25 * 60 * 1000,
  soulx_talkhead: 30 * 60 * 1000,
  concat: 10 * 60 * 1000,
  whisper_align: 15 * 60 * 1000,
  burn_subs: 15 * 60 * 1000,
};

const globalForPodcastVideoRecovery = globalThis as typeof globalThis & {
  __podcastVideoRecoveryPromise?: Promise<void>;
  __podcastVideoRecoveryLastRunAt?: number;
};

async function atomicWrite(filePath: string, data: unknown): Promise<void> {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}

export async function initStatus(jobId: string, phases: JobPhaseId[] = JOB_PHASES): Promise<JobStatus> {
  const paths = await ensurePodcastVideoArchiveDir(jobId);
  const now = new Date().toISOString();
  const status: JobStatus = {
    job_id: jobId,
    phase: null,
    phase_index: 0,
    phase_total: phases.length,
    percent: 0,
    state: 'queued',
    message: 'Queued',
    started_at: now,
    updated_at: now,
    phase_progress: null,
    result: null,
    error: null,
  };
  await atomicWrite(paths.status, status);
  return status;
}

export async function readStatus(jobId: string): Promise<JobStatus | null> {
  const paths = getPodcastVideoJobPaths(jobId);
  try {
    const raw = await fs.readFile(paths.status, 'utf8');
    return JSON.parse(raw) as JobStatus;
  } catch {
    try {
      // one retry in case we hit the rename race
      const raw = await fs.readFile(paths.status, 'utf8');
      return JSON.parse(raw) as JobStatus;
    } catch {
      return null;
    }
  }
}

export async function updateStatus(
  jobId: string,
  patch: Partial<Omit<JobStatus, 'job_id' | 'started_at'>>
): Promise<void> {
  const paths = getPodcastVideoJobPaths(jobId);
  const current = (await readStatus(jobId)) ?? (await initStatus(jobId));
  const next: JobStatus = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  await atomicWrite(paths.status, next);
}

export async function setPhase(
  jobId: string,
  phase: JobPhaseId,
  message: string,
  phaseProgress: { current: number; total: number } | null = null,
  phases: JobPhaseId[] = JOB_PHASES
): Promise<void> {
  const phaseIndex = Math.max(0, phases.indexOf(phase));
  const phaseTotal = phases.length;
  const basePercent = Math.round((phaseIndex / phaseTotal) * 100);
  const bump =
    phaseProgress && phaseProgress.total > 0
      ? Math.round((phaseProgress.current / phaseProgress.total) * (100 / phaseTotal))
      : 0;
  const percent = Math.min(99, basePercent + bump);
  await updateStatus(jobId, {
    phase,
    phase_index: phaseIndex,
    phase_total: phaseTotal,
    percent,
    state: 'running',
    message,
    phase_progress: phaseProgress,
  });
}

export async function markDone(jobId: string, result: unknown): Promise<void> {
  await updateStatus(jobId, {
    state: 'done',
    percent: 100,
    message: 'Done',
    phase_progress: null,
    result,
    error: null,
  });
}

export async function markFailed(
  jobId: string,
  detail: string,
  phase: JobPhaseId | null,
  code?: string
): Promise<void> {
  await updateStatus(jobId, {
    state: 'failed',
    message: `Failed at ${phase ?? 'unknown'}`,
    phase_progress: null,
    error: { phase, code, detail: detail.slice(0, 2000) },
  });
}

function getStatusActivityTimestampMs(status: JobStatus): number | null {
  for (const value of [status.updated_at, status.started_at]) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function wasInterruptedByServiceRestart(status: JobStatus): boolean {
  if (status.state !== 'running') {
    return false;
  }

  const activityTimestampMs = getStatusActivityTimestampMs(status);
  if (activityTimestampMs === null) {
    return false;
  }

  return activityTimestampMs + INTERRUPTED_JOB_RECOVERY_GRACE_MS < PROCESS_STARTED_AT_MS;
}

function getRunningJobStaleTimeoutMs(status: JobStatus): number {
  if (!status.phase) {
    return DEFAULT_RUNNING_JOB_STALE_TIMEOUT_MS;
  }

  return RUNNING_JOB_STALE_TIMEOUT_MS[status.phase] ?? DEFAULT_RUNNING_JOB_STALE_TIMEOUT_MS;
}

function getRunningJobRecoveryFailure(
  status: JobStatus,
  nowMs: number
): { code: 'service_restart' | 'stalled_job'; detail: string } | null {
  if (status.state !== 'running') {
    return null;
  }

  const activityTimestampMs = getStatusActivityTimestampMs(status);
  if (activityTimestampMs === null) {
    return null;
  }

  if (wasInterruptedByServiceRestart(status)) {
    return {
      code: 'service_restart',
      detail: 'Job interrupted by aipodcast service restart.',
    };
  }

  const staleTimeoutMs = getRunningJobStaleTimeoutMs(status);
  if (activityTimestampMs + staleTimeoutMs < nowMs) {
    const timeoutMinutes = Math.round(staleTimeoutMs / 60000);
    return {
      code: 'stalled_job',
      detail: `Job stalled in ${status.phase ?? 'unknown'} with no status update for over ${timeoutMinutes} minutes.`,
    };
  }

  return null;
}

async function recoverRunningJobs(): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(PODCAST_VIDEO_ARCHIVE_DIR, {
      withFileTypes: true,
      encoding: 'utf8',
    });
  } catch {
    return;
  }

  const nowMs = Date.now();
  const recoveredJobs: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const status = await readStatus(entry.name);
    if (!status) {
      continue;
    }

    const failure = getRunningJobRecoveryFailure(status, nowMs);
    if (!failure) {
      continue;
    }

    await markFailed(entry.name, failure.detail, status.phase, failure.code);
    recoveredJobs.push(`${entry.name}:${failure.code}`);
  }

  if (recoveredJobs.length > 0) {
    console.warn(
      `[podcast-film] recovered ${recoveredJobs.length} stale/interrupted job(s): ${recoveredJobs.join(', ')}`
    );
  }
}

export async function ensureRunningJobRecovery(): Promise<void> {
  const nowMs = Date.now();

  if (globalForPodcastVideoRecovery.__podcastVideoRecoveryPromise) {
    await globalForPodcastVideoRecovery.__podcastVideoRecoveryPromise;
    return;
  }

  const lastRunAt = globalForPodcastVideoRecovery.__podcastVideoRecoveryLastRunAt ?? 0;
  if (nowMs - lastRunAt < RECOVERY_SWEEP_MIN_INTERVAL_MS) {
    return;
  }

  globalForPodcastVideoRecovery.__podcastVideoRecoveryPromise = recoverRunningJobs()
    .catch((error) => {
      console.error('[podcast-film] running job recovery failed:', error);
    })
    .finally(() => {
      globalForPodcastVideoRecovery.__podcastVideoRecoveryLastRunAt = Date.now();
      globalForPodcastVideoRecovery.__podcastVideoRecoveryPromise = undefined;
    });

  await globalForPodcastVideoRecovery.__podcastVideoRecoveryPromise;
}

export async function ensureInterruptedJobRecovery(): Promise<void> {
  await ensureRunningJobRecovery();
}
