import { promises as fs } from 'fs';
import type { Dirent } from 'fs';
import path from 'path';
import {
  PODCAST_VIDEO_ARCHIVE_DIR,
  buildPodcastVideoFileUrl,
  fileExists,
  getPodcastVideoJobPaths,
  readJsonFile,
} from '@/lib/podcast-video/archive';
import { getPodcastVideoJobAvailability } from '@/lib/podcast-video/jobs';
import type { PodcastVideoJobRecord } from '@/lib/podcast-video/types';
import type { JobStatus } from '@/lib/podcast-video/job-status';

type PersistedClientJob = {
  workflow: 'workflow-a' | 'workflow-b';
  jobId: string;
  title: string;
  language: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  stage: string;
  progress: number;
  message: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  engineUsed: string | null;
  renderMode: string | null;
  fallbackReason: string | null;
  captionSettings: {
    style: string;
    font_size: number;
    line_color: string;
    word_color: string;
    outline_color: string;
  };
  artifacts: {
    json_url: string | null;
    mp3_url: string | null;
    srt_url: string | null;
    mp4_url: string | null;
    stem_speaker1_url: string | null;
    stem_speaker2_url: string | null;
    segment_urls: string[] | null;
  };
  availableArtifacts: {
    json: boolean;
    mp3: boolean;
    srt: boolean;
    mp4: boolean;
    stem1: boolean;
    stem2: boolean;
  };
  statusUrl: string | null;
  pipeline: string | null;
  ttsProvider: string | null;
  avatarProvider: string | null;
  reviewMode: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeWorkflowBState(state: string | null): PersistedClientJob['status'] {
  if (state === 'done') return 'success';
  if (state === 'failed') return 'failed';
  if (state === 'queued') return 'queued';
  return 'running';
}

async function readOptionalJson(filePath: string): Promise<Record<string, unknown> | null> {
  const parsed = await readJsonFile<unknown>(filePath);
  return isRecord(parsed) ? parsed : null;
}

async function readOptionalTitle(jobId: string): Promise<string | null> {
  const titlePath = path.join(getPodcastVideoJobPaths(jobId).dir, 'title.txt');
  if (!(await fileExists(titlePath))) {
    return null;
  }

  try {
    const raw = await fs.readFile(titlePath, 'utf8');
    const normalized = raw.replace(/\s+/g, ' ').trim();
    return normalized || null;
  } catch {
    return null;
  }
}

function buildArtifactUrls(publicBaseUrl: string, jobId: string) {
  return {
    json_url: buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'json'),
    mp3_url: buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'mp3'),
    srt_url: buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'srt'),
    mp4_url: buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'mp4'),
    stem_speaker1_url: buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'stem1'),
    stem_speaker2_url: buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'stem2'),
    segment_urls: [] as string[],
  };
}

async function fromWorkflowARecord(
  record: PodcastVideoJobRecord,
  publicBaseUrl: string
): Promise<PersistedClientJob | null> {
  const availableArtifacts = await getPodcastVideoJobAvailability(record.jobId);
  if (!availableArtifacts.mp4) {
    return null;
  }

  const normalizedRequest = await readOptionalJson(
    path.join(getPodcastVideoJobPaths(record.jobId).dir, 'request.normalized.json')
  );
  const tts = isRecord(normalizedRequest?.tts) ? normalizedRequest.tts : null;
  const avatar = isRecord(normalizedRequest?.avatar) ? normalizedRequest.avatar : null;
  const review = isRecord(normalizedRequest?.review) ? normalizedRequest.review : null;
  const urls = buildArtifactUrls(publicBaseUrl, record.jobId);

  return {
    workflow: 'workflow-a',
    jobId: record.jobId,
    title: record.title || record.jobId,
    language: record.language || 'pl',
    status: record.status,
    stage: record.stage,
    progress: record.progress,
    message: record.message,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
    engineUsed: record.engineUsed,
    renderMode: record.renderMode,
    fallbackReason: record.fallbackReason,
    captionSettings: record.captionSettings,
    artifacts: {
      json_url: availableArtifacts.json ? urls.json_url : null,
      mp3_url: availableArtifacts.mp3 ? urls.mp3_url : null,
      srt_url: availableArtifacts.srt ? urls.srt_url : null,
      mp4_url: urls.mp4_url,
      stem_speaker1_url: availableArtifacts.stem1 ? urls.stem_speaker1_url : null,
      stem_speaker2_url: availableArtifacts.stem2 ? urls.stem_speaker2_url : null,
      segment_urls: null,
    },
    availableArtifacts,
    statusUrl: `${publicBaseUrl}/api/podcast-video/jobs/${encodeURIComponent(record.jobId)}`,
    pipeline: 'podcast-video-v1',
    ttsProvider: readString(tts || {}, 'provider'),
    avatarProvider: readString(avatar || {}, 'provider'),
    reviewMode: readString(review || {}, 'mode') || 'off',
  };
}

async function fromWorkflowBStatus(
  status: JobStatus,
  publicBaseUrl: string
): Promise<PersistedClientJob | null> {
  const jobId = status.job_id;
  const availableArtifacts = await getPodcastVideoJobAvailability(jobId);
  if (!availableArtifacts.mp4) {
    return null;
  }

  const result = isRecord(status.result) ? status.result : {};
  const urls = buildArtifactUrls(publicBaseUrl, jobId);
  const title = readString(result, 'title') || (await readOptionalTitle(jobId)) || jobId;
  const language = readString(result, 'language') || 'pl';

  return {
    workflow: 'workflow-b',
    jobId,
    title,
    language,
    status: normalizeWorkflowBState(status.state),
    stage: status.phase || status.state || 'done',
    progress: status.percent,
    message: status.message,
    error: isRecord(status.error) ? readString(status.error, 'detail') : null,
    createdAt: status.started_at,
    updatedAt: status.updated_at,
    completedAt: status.state === 'done' || status.state === 'failed' ? status.updated_at : null,
    engineUsed: 'soulx',
    renderMode: 'avatar_concat',
    fallbackReason: null,
    captionSettings: {
      style: readString(result, 'caption_style') || 'highlight',
      font_size: readNumber(result, 'caption_font_size') ?? 86,
      line_color: readString(result, 'caption_line_color') || '#FFFFFF',
      word_color: readString(result, 'caption_word_color') || '#00FF04',
      outline_color: '#000000',
    },
    artifacts: {
      json_url: null,
      mp3_url: null,
      srt_url: availableArtifacts.srt ? urls.srt_url : null,
      mp4_url: urls.mp4_url,
      stem_speaker1_url: null,
      stem_speaker2_url: null,
      segment_urls: null,
    },
    availableArtifacts,
    statusUrl: `${publicBaseUrl}/api/podcast-video/podcast-film/jobs/${encodeURIComponent(jobId)}/status`,
    pipeline: 'podcast-film-v1',
    ttsProvider: readString(result, 'tts_engine'),
    avatarProvider: 'soulx',
    reviewMode: 'off',
  };
}

async function readPersistedJob(
  jobId: string,
  publicBaseUrl: string
): Promise<PersistedClientJob | null> {
  const raw = await readJsonFile<unknown>(getPodcastVideoJobPaths(jobId).status);
  if (!isRecord(raw)) {
    return null;
  }

  if (typeof raw.jobId === 'string') {
    return fromWorkflowARecord(raw as unknown as PodcastVideoJobRecord, publicBaseUrl);
  }

  if (typeof raw.job_id === 'string') {
    return fromWorkflowBStatus(raw as unknown as JobStatus, publicBaseUrl);
  }

  return null;
}

export async function listPersistedPodcastVideoJobs(
  publicBaseUrl: string,
  limit = 30
): Promise<PersistedClientJob[]> {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(PODCAST_VIDEO_ARCHIVE_DIR, {
      withFileTypes: true,
      encoding: 'utf8',
    });
  } catch {
    return [];
  }

  const jobs = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => readPersistedJob(entry.name, publicBaseUrl))
    )
  ).filter((job): job is PersistedClientJob => Boolean(job));

  jobs.sort((left, right) => {
    const leftTs = Date.parse(left.updatedAt || left.createdAt || '') || 0;
    const rightTs = Date.parse(right.updatedAt || right.createdAt || '') || 0;
    return rightTs - leftTs;
  });

  return jobs.slice(0, limit);
}

export async function deletePersistedPodcastVideoJob(jobId: string): Promise<boolean> {
  const jobDir = getPodcastVideoJobPaths(jobId).dir;
  if (!(await fileExists(jobDir))) {
    return false;
  }

  await fs.rm(jobDir, { recursive: true, force: true });
  return true;
}

export async function isPersistedPodcastVideoJobBusy(jobId: string): Promise<boolean> {
  const raw = await readJsonFile<unknown>(getPodcastVideoJobPaths(jobId).status);
  if (!isRecord(raw)) {
    return false;
  }

  if (typeof raw.status === 'string') {
    return raw.status === 'queued' || raw.status === 'running';
  }

  if (typeof raw.state === 'string') {
    return raw.state === 'queued' || raw.state === 'running';
  }

  return false;
}
