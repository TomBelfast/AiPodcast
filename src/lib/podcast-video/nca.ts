import {
  DEFAULT_PODCAST_VIDEO_CAPTION_SETTINGS,
  type PodcastVideoCaptionSettings,
} from '@/lib/podcast-video/types';

const VALID_STYLES = new Set([
  'karaoke',
  'highlight',
  'classic',
  'word_by_word',
  'underline',
]);

function normalizeHexColor(value: string | undefined, fallback: string): string {
  const cleaned = (value || '').trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}

export function resolveCaptionSettings(
  input?: Partial<PodcastVideoCaptionSettings>
): PodcastVideoCaptionSettings {
  const requestedStyle = (input?.style || DEFAULT_PODCAST_VIDEO_CAPTION_SETTINGS.style).trim();
  const style = VALID_STYLES.has(requestedStyle)
    ? requestedStyle
    : DEFAULT_PODCAST_VIDEO_CAPTION_SETTINGS.style;

  const fontSize = Number.isFinite(input?.font_size)
    ? Math.max(24, Math.min(96, Number(input?.font_size)))
    : DEFAULT_PODCAST_VIDEO_CAPTION_SETTINGS.font_size;

  return {
    style,
    font_size: fontSize,
    line_color: normalizeHexColor(
      input?.line_color,
      DEFAULT_PODCAST_VIDEO_CAPTION_SETTINGS.line_color
    ),
    word_color: normalizeHexColor(
      input?.word_color,
      DEFAULT_PODCAST_VIDEO_CAPTION_SETTINGS.word_color
    ),
    outline_color: normalizeHexColor(
      input?.outline_color,
      DEFAULT_PODCAST_VIDEO_CAPTION_SETTINGS.outline_color
    ),
  };
}

function getNcaBaseUrl(): string {
  return (
    process.env.PODCAST_VIDEO_NCA_API_URL ||
    process.env.PODCAST_NCA_API_URL ||
    process.env.PODCAST_EXTERNAL_NCA_API_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
}

function getNcaApiKey(): string {
  return (
    process.env.PODCAST_VIDEO_NCA_SECRET_KEY ||
    process.env.PODCAST_VIDEO_NCA_API_KEY ||
    process.env.PODCAST_NCA_SECRET_KEY ||
    process.env.PODCAST_NCA_API_KEY ||
    process.env.NCA_SECRET_KEY ||
    process.env.SECRET_KEY ||
    process.env.API_KEY ||
    ''
  ).trim();
}

function getPublicStorageBaseUrl(): string {
  return (
    process.env.PODCAST_VIDEO_NCA_PUBLIC_STORAGE_URL ||
    process.env.PODCAST_NCA_PUBLIC_STORAGE_URL ||
    process.env.PODCAST_VIDEO_MINIO_PUBLIC_URL ||
    process.env.PODCAST_MINIO_PUBLIC_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
}

function getStageTimeoutMs(envName: string, fallbackSeconds: number): number {
  const raw = process.env[envName]?.trim();
  if (!raw) {
    return fallbackSeconds * 1000;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackSeconds * 1000;
  }

  return parsed * 1000;
}

function rewritePublicStorageUrl(url: string | null): string | null {
  if (!url || !url.startsWith('http')) {
    return url;
  }

  const publicBase = getPublicStorageBaseUrl();
  if (!publicBase) {
    return url;
  }

  const parsed = new URL(url);
  if (!['minio', 'localhost', '127.0.0.1'].includes(parsed.hostname)) {
    return url;
  }

  const publicUrl = new URL(publicBase);
  parsed.protocol = publicUrl.protocol;
  parsed.host = publicUrl.host;
  return parsed.toString();
}

function extractResponseMessage(payload: any): string {
  if (!payload) {
    return '';
  }

  if (typeof payload.message === 'string') {
    return payload.message;
  }

  if (payload.message && typeof payload.message.error === 'string') {
    return payload.message.error;
  }

  return '';
}

function extractFileUrl(payload: any): string | null {
  const response = payload?.response;
  let extracted: string | null = null;

  if (typeof response === 'string' && response.startsWith('http')) {
    extracted = response;
  } else if (Array.isArray(response) && response.length > 0) {
    const first = response[0];
    if (typeof first === 'string' && first.startsWith('http')) {
      extracted = first;
    } else if (first && typeof first === 'object') {
      extracted = first.file_url || first.url || null;
    }
  } else if (response && typeof response === 'object') {
    extracted = response.file_url || response.url || null;
  }

  return rewritePublicStorageUrl(extracted);
}

async function postJson(endpointPath: string, payload: unknown, timeoutMs: number): Promise<any> {
  const baseUrl = getNcaBaseUrl();
  const apiKey = getNcaApiKey();

  if (!baseUrl) {
    throw new Error('PODCAST_VIDEO_NCA_API_URL is not configured.');
  }
  if (!apiKey) {
    throw new Error('PODCAST_VIDEO_NCA_SECRET_KEY is not configured.');
  }

  const response = await fetch(`${baseUrl}${endpointPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const rawText = await response.text();
  let parsedBody: any = null;
  try {
    parsedBody = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsedBody = { raw: rawText };
  }

  if (!response.ok) {
    const message = extractResponseMessage(parsedBody) || rawText || response.statusText;
    throw new Error(`${endpointPath} error ${response.status}: ${message.slice(0, 300)}`);
  }

  return parsedBody;
}

export async function composePodcastVideo(args: {
  jobId: string;
  audioUrl: string;
  imageUrl: string;
}): Promise<string> {
  const payload = {
    id: `${args.jobId}_compose`,
    inputs: [
      {
        file_url: args.imageUrl,
        options: [{ option: '-loop', argument: '1' }],
      },
      {
        file_url: args.audioUrl,
      },
    ],
    outputs: [
      {
        options: [
          { option: '-c:v', argument: 'libx264' },
          { option: '-tune', argument: 'stillimage' },
          { option: '-r', argument: '12' },
          { option: '-c:a', argument: 'aac' },
          { option: '-b:a', argument: '192k' },
          { option: '-pix_fmt', argument: 'yuv420p' },
          {
            option: '-vf',
            argument:
              'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920',
          },
          { option: '-shortest', argument: null },
        ],
      },
    ],
  };

  const response = await postJson(
    '/v1/ffmpeg/compose',
    payload,
    getStageTimeoutMs('PODCAST_VIDEO_NCA_COMPOSE_TIMEOUT', 420)
  );

  const url = extractFileUrl(response);
  if (!url) {
    throw new Error('NCA compose finished without returning a video URL.');
  }

  return url;
}

export async function renderPodcastCaptions(args: {
  jobId: string;
  videoUrl: string;
  settings: PodcastVideoCaptionSettings;
  srtUrl?: string | null;
  preferExactText?: boolean;
}): Promise<{
  url: string;
  effectiveStyle: string;
  captionSource: 'provided_srt' | 'auto_transcribe';
}> {
  const useProvidedCaptions = Boolean(args.preferExactText !== false && args.srtUrl);
  const effectiveStyle = useProvidedCaptions ? 'classic' : args.settings.style;
  const payload: Record<string, unknown> = {
    id: `${args.jobId}_caption`,
    video_url: args.videoUrl,
    language: 'auto',
    settings: {
      style: effectiveStyle,
      line_color: args.settings.line_color,
      word_color: args.settings.word_color,
      outline_color: args.settings.outline_color,
      outline_width: 4,
      max_words_per_line: 4,
      font_size: args.settings.font_size,
      font_family: 'Arial',
      position: 'bottom_center',
      alignment: 'center',
      bold: true,
      all_caps: false,
    },
  };

  if (useProvidedCaptions) {
    payload.captions = args.srtUrl;
  }

  const response = await postJson(
    '/v1/video/caption',
    payload,
    getStageTimeoutMs('PODCAST_VIDEO_NCA_CAPTION_TIMEOUT', 420)
  );

  const url = extractFileUrl(response);
  if (!url) {
    throw new Error('NCA caption finished without returning a final MP4 URL.');
  }

  return {
    url,
    effectiveStyle,
    captionSource: useProvidedCaptions ? 'provided_srt' : 'auto_transcribe',
  };
}
