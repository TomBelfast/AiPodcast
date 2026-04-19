import { promises as fs } from 'fs';
import { getPodcastVideoJobPaths, ensurePodcastVideoArchiveDir } from './archive';

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
