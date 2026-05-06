import {
  buildPodcastVideoFileUrl,
  ensurePodcastVideoArchiveDir,
  fileExists,
  getPodcastVideoJobPaths,
  readJsonFile,
  writeJsonFile,
} from '@/lib/podcast-video/archive';
import type {
  PodcastVideoCaptionSettings,
  PodcastVideoJobRecord,
  PodcastVideoStage,
  PodcastVideoStatus,
} from '@/lib/podcast-video/types';

declare global {
  var __podcastVideoJobs: Map<string, PodcastVideoJobRecord> | undefined;
}

const jobs =
  global.__podcastVideoJobs ?? (global.__podcastVideoJobs = new Map<string, PodcastVideoJobRecord>());

function getArtifactUrls(publicBaseUrl: string, jobId: string) {
  return {
    json_url: buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'json'),
    mp3_url: buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'mp3'),
    srt_url: buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'srt'),
    mp4_url: buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'mp4'),
    stem_speaker1_url: buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'stem1'),
    stem_speaker2_url: buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'stem2'),
    segment_urls: [],
  };
}

async function saveJobToDisk(record: PodcastVideoJobRecord): Promise<void> {
  await writeJsonFile(record.files.status_path || getPodcastVideoJobPaths(record.jobId).status, record);
}

export async function createPodcastVideoJob(args: {
  jobId: string;
  title: string;
  language: string;
  sourceJobId?: string | null;
  publicBaseUrl: string;
  captionSettings: PodcastVideoCaptionSettings;
  inputSummary: PodcastVideoJobRecord['inputSummary'];
}): Promise<PodcastVideoJobRecord> {
  const now = new Date().toISOString();
  const paths = await ensurePodcastVideoArchiveDir(args.jobId);

  const record: PodcastVideoJobRecord = {
    jobId: args.jobId,
    title: args.title,
    language: args.language,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    message: 'Job zostal przyjety do kolejki.',
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    sourceJobId: args.sourceJobId || null,
    publicBaseUrl: args.publicBaseUrl,
    captionSettings: args.captionSettings,
    engineUsed: null,
    renderMode: null,
    fallbackReason: null,
    inputSummary: args.inputSummary,
    artifacts: getArtifactUrls(args.publicBaseUrl, args.jobId),
    files: {
      transcript_path: paths.transcript,
      audio_path: paths.audio,
      srt_path: paths.srt,
      mp4_path: paths.mp4,
      status_path: paths.status,
      stem_speaker1_path: paths.stem1,
      stem_speaker2_path: paths.stem2,
      segment_paths: [],
    },
  };

  jobs.set(record.jobId, record);
  await saveJobToDisk(record);
  return record;
}

export async function getPodcastVideoJob(jobId: string): Promise<PodcastVideoJobRecord | null> {
  const cached = jobs.get(jobId);
  if (cached) {
    return cached;
  }

  const paths = getPodcastVideoJobPaths(jobId);
  const fromDisk = await readJsonFile<PodcastVideoJobRecord>(paths.status);
  if (!fromDisk) {
    return null;
  }

  jobs.set(jobId, fromDisk);
  return fromDisk;
}

export function evictPodcastVideoJob(jobId: string): void {
  jobs.delete(jobId);
}

export async function updatePodcastVideoJob(
  jobId: string,
  updates: Partial<PodcastVideoJobRecord>
): Promise<PodcastVideoJobRecord> {
  const current = await getPodcastVideoJob(jobId);
  if (!current) {
    throw new Error(`Podcast video job not found: ${jobId}`);
  }

  const nextStatus = updates.status ?? current.status;
  const shouldMarkComplete = nextStatus === 'success' || nextStatus === 'failed';

  const updated: PodcastVideoJobRecord = {
    ...current,
    ...updates,
    captionSettings: {
      ...current.captionSettings,
      ...(updates.captionSettings || {}),
    },
    inputSummary: {
      ...current.inputSummary,
      ...(updates.inputSummary || {}),
    },
    artifacts: {
      ...current.artifacts,
      ...(updates.artifacts || {}),
    },
    files: {
      ...current.files,
      ...(updates.files || {}),
    },
    updatedAt: new Date().toISOString(),
    completedAt: shouldMarkComplete
      ? updates.completedAt || current.completedAt || new Date().toISOString()
      : current.completedAt,
  };

  jobs.set(jobId, updated);
  await saveJobToDisk(updated);
  return updated;
}

export async function setPodcastVideoJobStage(
  jobId: string,
  stage: PodcastVideoStage,
  progress: number,
  message: string,
  status: PodcastVideoStatus = 'running'
): Promise<PodcastVideoJobRecord> {
  return updatePodcastVideoJob(jobId, {
    stage,
    progress,
    message,
    status,
  });
}

export async function failPodcastVideoJob(
  jobId: string,
  stage: PodcastVideoStage,
  error: string,
  progress = 0
): Promise<PodcastVideoJobRecord> {
  return updatePodcastVideoJob(jobId, {
    status: 'failed',
    stage,
    progress,
    message: error,
    error,
  });
}

export async function getPodcastVideoJobAvailability(jobId: string) {
  const paths = getPodcastVideoJobPaths(jobId);
  const [json, mp3, srt, mp4, stem1, stem2] = await Promise.all([
    fileExists(paths.transcript),
    fileExists(paths.audio),
    fileExists(paths.srt),
    fileExists(paths.mp4),
    fileExists(paths.stem1),
    fileExists(paths.stem2),
  ]);

  return { json, mp3, srt, mp4, stem1, stem2 };
}

export function toClientPodcastVideoJob(
  record: PodcastVideoJobRecord,
  availableArtifacts?: Awaited<ReturnType<typeof getPodcastVideoJobAvailability>>
) {
  const { files: _files, ...rest } = record;
  void _files;
  return {
    ...rest,
    availableArtifacts,
  };
}
