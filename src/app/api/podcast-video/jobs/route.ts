import { promises as fs } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import {
  createPodcastVideoJob,
  getPodcastVideoJob,
  getPodcastVideoJobAvailability,
  toClientPodcastVideoJob,
} from '@/lib/podcast-video/jobs';
import { resolveCaptionSettings } from '@/lib/podcast-video/nca';
import { runPodcastVideoJob } from '@/lib/podcast-video/orchestrator';
import { resolvePublicBaseUrl, isPodcastVideoAuthorized } from '@/lib/podcast-video/http';
import {
  fileExists,
  getArtifactContentType,
  getArtifactPathByType,
  writeJsonFile,
} from '@/lib/podcast-video/archive';
import type { PodcastVideoJobRequest } from '@/lib/podcast-video/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RawBody = Record<string, unknown>;
type SynchronousReturnType = 'job' | 'mp4_url' | 'mp4';

function buildJobId(): string {
  return `podcast_video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function findNestedObject(source: RawBody, key: string): Record<string, unknown> | null {
  const candidate = source[key];
  return isPlainObject(candidate) ? candidate : null;
}

function collectCandidateObjects(body: RawBody): Record<string, unknown>[] {
  const candidates = [
    body,
    findNestedObject(body, 'payload'),
    findNestedObject(body, 'data'),
    findNestedObject(body, 'request'),
  ].filter((value): value is Record<string, unknown> => Boolean(value));

  return candidates.filter(
    (candidate, index) => candidates.findIndex((item) => item === candidate) === index
  );
}

function pickString(candidates: Record<string, unknown>[], keys: string[]): string | null {
  for (const candidate of candidates) {
    for (const key of keys) {
      const normalized = normalizeString(candidate[key]);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function pickBoolean(candidates: Record<string, unknown>[], keys: string[]): boolean | null {
  for (const candidate of candidates) {
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'y'].includes(normalized)) {
          return true;
        }
        if (['false', '0', 'no', 'n'].includes(normalized)) {
          return false;
        }
      }
    }
  }

  return null;
}

function pickNumber(candidates: Record<string, unknown>[], keys: string[]): number | null {
  for (const candidate of candidates) {
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
  }

  return null;
}

function pickArray(candidates: Record<string, unknown>[], keys: string[]): unknown[] | null {
  for (const candidate of candidates) {
    for (const key of keys) {
      const value = candidate[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
  }

  return null;
}

function pickObject(candidates: Record<string, unknown>[], keys: string[]): Record<string, unknown> | null {
  for (const candidate of candidates) {
    for (const key of keys) {
      const value = candidate[key];
      if (isPlainObject(value)) {
        return value;
      }
    }
  }

  return null;
}

function normalizeConversationItems(input: unknown[] | null): PodcastVideoJobRequest['conversation'] {
  if (!input) {
    return undefined;
  }

  const conversation = input
    .map((item) => {
      if (!isPlainObject(item)) {
        return null;
      }

      const speaker =
        normalizeString(item.speaker) ||
        normalizeString(item.name) ||
        normalizeString(item.role) ||
        'Speaker1';
      const text =
        normalizeString(item.text) ||
        normalizeString(item.content) ||
        normalizeString(item.message);

      if (!text) {
        return null;
      }

      return { speaker, text };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return conversation.length ? conversation : undefined;
}

function normalizeTranscript(input: Record<string, unknown> | null): PodcastVideoJobRequest['transcript'] {
  if (!input) {
    return undefined;
  }

  return input as PodcastVideoJobRequest['transcript'];
}

function resolveSynchronousReturnType(value: string | null): SynchronousReturnType {
  const normalized = (value || '').trim().toLowerCase();
  if (['mp4', 'file', 'binary', 'video'].includes(normalized)) {
    return 'mp4';
  }
  if (['mp4_url', 'url', 'link'].includes(normalized)) {
    return 'mp4_url';
  }
  return 'job';
}

function resolveWaitTimeout(raw: number | null): number {
  if (!raw || !Number.isFinite(raw)) {
    return 15 * 60 * 1000;
  }

  return Math.max(5_000, Math.min(raw, 30 * 60 * 1000));
}

function buildScriptTextFromTopic(topic: string): string {
  return `Stworz krotki podcast po polsku na temat: ${topic}. Ma byc dynamiczny, naturalny i w dwoch glosach.`;
}

function normalizeIncomingRequest(body: RawBody, request: NextRequest) {
  const candidates = collectCandidateObjects(body);

  const topic = pickString(candidates, ['topic', 'subject', 'theme']);
  const directScriptText = pickString(candidates, [
    'script_text',
    'scriptText',
    'transcript',
    'content',
    'text',
    'prompt',
    'description',
  ]);

  const conversation = normalizeConversationItems(
    pickArray(candidates, ['conversation', 'dialogue', 'messages'])
  );
  const transcript = normalizeTranscript(
    pickObject(candidates, ['transcript', 'normalizedTranscript', 'normalized_transcript'])
  );

  const normalizedRequest: PodcastVideoJobRequest = {
    title: pickString(candidates, ['title', 'name']) || topic || 'Podcast Video',
    language: pickString(candidates, ['language', 'lang', 'locale']) || 'pl',
    script_text: directScriptText || (topic ? buildScriptTextFromTopic(topic) : undefined),
    conversation,
    transcript,
    voice1: pickString(candidates, ['voice1', 'voice_1', 'host1_voice', 'speaker1_voice']) || undefined,
    voice2: pickString(candidates, ['voice2', 'voice_2', 'host2_voice', 'speaker2_voice']) || undefined,
    source_job_id:
      pickString(candidates, ['source_job_id', 'sourceJobId', 'job_id', 'jobId']) || undefined,
    exact_captions:
      pickBoolean(candidates, ['exact_captions', 'exactCaptions']) ?? true,
    style: pickString(candidates, ['style', 'caption_style', 'captionStyle']) || undefined,
    font_size: pickNumber(candidates, ['font_size', 'fontSize']) || undefined,
    line_color: pickString(candidates, ['line_color', 'lineColor']) || undefined,
    word_color: pickString(candidates, ['word_color', 'wordColor']) || undefined,
    outline_color: pickString(candidates, ['outline_color', 'outlineColor']) || undefined,
  };

  const queryWait = normalizeString(request.nextUrl.searchParams.get('wait'));
  const queryReturnType = normalizeString(request.nextUrl.searchParams.get('return'));
  const queryTimeout = normalizeString(request.nextUrl.searchParams.get('timeout_ms'));

  const waitForCompletion =
    (queryWait ? ['1', 'true', 'yes'].includes(queryWait.toLowerCase()) : null) ??
    (pickBoolean(candidates, [
      'wait_for_completion',
      'waitForCompletion',
      'sync',
      'blocking',
    ]) ?? false);
  const dryRun =
    pickBoolean(candidates, ['dry_run', 'dryRun', 'validate_only', 'validateOnly']) ?? false;

  const returnType = queryReturnType
    ? resolveSynchronousReturnType(queryReturnType)
    : resolveSynchronousReturnType(
        pickString(candidates, ['return_type', 'returnType', 'response_mode', 'responseMode'])
      );

  const waitTimeoutMs = resolveWaitTimeout(
    queryTimeout ? Number(queryTimeout) : pickNumber(candidates, ['wait_timeout_ms', 'waitTimeoutMs'])
  );

  const requestSummary = {
    topLevelKeys: Object.keys(body),
    payloadKeys: Object.keys(findNestedObject(body, 'payload') || {}),
    dataKeys: Object.keys(findNestedObject(body, 'data') || {}),
    requestKeys: Object.keys(findNestedObject(body, 'request') || {}),
    resolvedInputMode: normalizedRequest.transcript
      ? 'transcript'
      : normalizedRequest.conversation?.length
        ? 'conversation'
        : normalizedRequest.script_text
          ? 'script_text'
          : 'unknown',
    usedTopicFallback: Boolean(topic && !directScriptText),
    topic,
    title: normalizedRequest.title,
    language: normalizedRequest.language,
    hasScriptText: Boolean(normalizedRequest.script_text),
    scriptTextLength: normalizedRequest.script_text?.length || 0,
    hasConversation: Boolean(normalizedRequest.conversation?.length),
    conversationCount: normalizedRequest.conversation?.length || 0,
    hasTranscript: Boolean(normalizedRequest.transcript),
    transcriptSegments: Array.isArray(normalizedRequest.transcript?.segments)
      ? normalizedRequest.transcript.segments.length
      : 0,
    transcriptWords: Array.isArray(normalizedRequest.transcript?.words)
      ? normalizedRequest.transcript.words.length
      : 0,
    exactCaptions: normalizedRequest.exact_captions ?? true,
    style: normalizedRequest.style || null,
    dryRun,
    waitForCompletion,
    waitTimeoutMs,
    returnType,
  };

  return {
    normalizedRequest,
    requestSummary,
    dryRun,
    waitForCompletion,
    waitTimeoutMs,
    returnType,
  };
}

function countConversationItems(request: PodcastVideoJobRequest): number {
  if (Array.isArray(request.conversation) && request.conversation.length > 0) {
    return request.conversation.length;
  }

  if (Array.isArray(request.transcript?.segments)) {
    return request.transcript.segments.length;
  }

  return 0;
}

export async function POST(request: NextRequest) {
  try {
    if (!isPodcastVideoAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = await request.json();
    if (!isPlainObject(parsedBody)) {
      return NextResponse.json(
        { error: 'Request body must be a JSON object.' },
        { status: 400 }
      );
    }

    const rawBody = parsedBody as RawBody;
    const {
      normalizedRequest,
      requestSummary,
      dryRun,
      waitForCompletion,
      waitTimeoutMs,
      returnType,
    } = normalizeIncomingRequest(rawBody, request);
    const hasScriptText = Boolean(normalizedRequest.script_text?.trim());
    const hasConversation =
      Array.isArray(normalizedRequest.conversation) && normalizedRequest.conversation.length > 0;
    const hasTranscript = Boolean(normalizedRequest.transcript);

    if (!hasScriptText && !hasConversation && !hasTranscript) {
      return NextResponse.json(
        {
          error: 'Request must include script_text, conversation, or transcript.',
        },
        { status: 400 }
      );
    }

    const jobId = buildJobId();
    const publicBaseUrl = resolvePublicBaseUrl(request);
    const title = normalizedRequest.title?.trim() || 'Podcast Video';
    const language = normalizedRequest.language?.trim() || 'pl';

    if (dryRun) {
      return NextResponse.json(
        {
          success: true,
          dry_run: true,
          message:
            'Payload zostal poprawnie odebrany i znormalizowany. Render nie zostal uruchomiony.',
          normalizedRequest,
          requestSummary,
          suggestedAsyncEndpoint: `${publicBaseUrl}/api/podcast-video/jobs`,
          suggestedSyncMp4UrlExample: `${publicBaseUrl}/api/podcast-video/jobs?wait=1&return=mp4_url`,
        },
        { status: 200 }
      );
    }

    const captionSettings = resolveCaptionSettings({
      style: normalizedRequest.style,
      font_size: normalizedRequest.font_size,
      line_color: normalizedRequest.line_color,
      word_color: normalizedRequest.word_color,
      outline_color: normalizedRequest.outline_color,
    });

    const job = await createPodcastVideoJob({
      jobId,
      title,
      language,
      sourceJobId: normalizedRequest.source_job_id || null,
      publicBaseUrl,
      captionSettings,
      inputSummary: {
        hasScriptText,
        hasConversation,
        hasTranscript,
        conversationCount: countConversationItems(normalizedRequest),
      },
    });

    const jobDir = path.dirname(job.files.status_path || '');
    await Promise.all([
      writeJsonFile(path.join(jobDir, 'request.original.json'), rawBody),
      writeJsonFile(path.join(jobDir, 'request.normalized.json'), normalizedRequest),
      writeJsonFile(path.join(jobDir, 'request.summary.json'), requestSummary),
    ]);

    console.info(
      '[podcast-video] incoming request summary:',
      JSON.stringify({
        jobId,
        ...requestSummary,
      })
    );

    const runPromise = runPodcastVideoJob(jobId, normalizedRequest).catch((error) => {
      console.error('[podcast-video] background job failed:', error);
      return error;
    });

    if (!waitForCompletion) {
      return NextResponse.json(
        {
          success: true,
          job: toClientPodcastVideoJob(job),
          statusUrl: `${publicBaseUrl}/api/podcast-video/jobs/${jobId}`,
        },
        { status: 202 }
      );
    }

    const waitResult = await Promise.race([
      runPromise.then(() => 'completed' as const),
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), waitTimeoutMs);
      }),
    ]);

    if (waitResult === 'timeout') {
      return NextResponse.json(
        {
          success: true,
          waiting: true,
          job: toClientPodcastVideoJob(job),
          statusUrl: `${publicBaseUrl}/api/podcast-video/jobs/${jobId}`,
          message:
            'Job nadal trwa. Kontynuuj polling statusUrl albo odbierz MP4 po zakonczeniu renderu.',
        },
        { status: 202 }
      );
    }

    const finalJob = await getPodcastVideoJob(jobId);
    if (!finalJob) {
      return NextResponse.json(
        { error: 'Job completed but could not be loaded from storage.' },
        { status: 500 }
      );
    }

    const availableArtifacts = await getPodcastVideoJobAvailability(jobId);
    const clientJob = toClientPodcastVideoJob(finalJob, availableArtifacts);

    if (finalJob.status !== 'success') {
      return NextResponse.json(
        {
          success: false,
          job: clientJob,
          statusUrl: `${publicBaseUrl}/api/podcast-video/jobs/${jobId}`,
          error: finalJob.error || finalJob.message || 'Podcast video job failed.',
        },
        { status: 500 }
      );
    }

    if (returnType === 'mp4') {
      const filePath = getArtifactPathByType(jobId, 'mp4');
      if (!(await fileExists(filePath))) {
        return NextResponse.json(
          { error: `Artifact mp4 not found for job ${jobId}.` },
          { status: 404 }
        );
      }

      const fileBuffer = await fs.readFile(filePath);
      return new NextResponse(new Uint8Array(fileBuffer), {
        headers: {
          'Content-Type': getArtifactContentType('mp4'),
          'Content-Length': fileBuffer.length.toString(),
          'Content-Disposition': `inline; filename="${jobId}.mp4"`,
          'Cache-Control': 'no-store',
          'X-Podcast-Video-Job-Id': jobId,
          'X-Podcast-Video-Status-Url': `${publicBaseUrl}/api/podcast-video/jobs/${jobId}`,
        },
      });
    }

    const payload = {
      success: true,
      job: clientJob,
      statusUrl: `${publicBaseUrl}/api/podcast-video/jobs/${jobId}`,
      mp4_url: finalJob.artifacts.mp4_url,
    };

    if (returnType === 'mp4_url') {
      return NextResponse.json(payload, { status: 200 });
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error('[podcast-video] failed to create job:', error);
    return NextResponse.json(
      { error: 'Failed to create podcast video job.' },
      { status: 500 }
    );
  }
}
