import { promises as fs } from 'fs';
import path from 'path';

export const PODCAST_VIDEO_ARCHIVE_DIR = path.join(
  process.cwd(),
  'archive',
  'podcast-video'
);

export interface PodcastVideoJobPaths {
  dir: string;
  status: string;
  transcript: string;
  audio: string;
  srt: string;
  mp4: string;
}

export function getPodcastVideoJobPaths(jobId: string): PodcastVideoJobPaths {
  const dir = path.join(PODCAST_VIDEO_ARCHIVE_DIR, jobId);
  return {
    dir,
    status: path.join(dir, 'status.json'),
    transcript: path.join(dir, 'transcript.json'),
    audio: path.join(dir, 'audio.mp3'),
    srt: path.join(dir, 'captions.srt'),
    mp4: path.join(dir, 'final.mp4'),
  };
}

export async function ensurePodcastVideoArchiveDir(jobId: string): Promise<PodcastVideoJobPaths> {
  const paths = getPodcastVideoJobPaths(jobId);
  await fs.mkdir(paths.dir, { recursive: true });
  return paths;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function writeTextFile(filePath: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data, 'utf8');
}

export async function writeBufferFile(filePath: string, data: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
}

export function buildPodcastVideoFileUrl(
  publicBaseUrl: string,
  jobId: string,
  type: 'json' | 'mp3' | 'srt' | 'mp4'
): string {
  const normalizedBase = publicBaseUrl.replace(/\/+$/, '');
  return `${normalizedBase}/api/podcast-video/jobs/${encodeURIComponent(jobId)}/file?type=${type}`;
}

export function getArtifactPathByType(
  jobId: string,
  type: 'json' | 'mp3' | 'srt' | 'mp4'
): string {
  const paths = getPodcastVideoJobPaths(jobId);
  switch (type) {
    case 'json':
      return paths.transcript;
    case 'mp3':
      return paths.audio;
    case 'srt':
      return paths.srt;
    case 'mp4':
      return paths.mp4;
  }
}

export function getArtifactContentType(type: 'json' | 'mp3' | 'srt' | 'mp4'): string {
  switch (type) {
    case 'json':
      return 'application/json; charset=utf-8';
    case 'mp3':
      return 'audio/mpeg';
    case 'srt':
      return 'application/x-subrip; charset=utf-8';
    case 'mp4':
      return 'video/mp4';
  }
}
