import { NextRequest, NextResponse } from 'next/server';
import { isPodcastVideoAuthorized } from '@/lib/podcast-video/http';
import {
  ensureRunningJobRecovery,
  readStatus,
  type JobStatus,
} from '@/lib/podcast-video/job-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildStatusResponse(status: JobStatus): Record<string, unknown> {
  const response: Record<string, unknown> = { ...status };
  const result = isPlainObject(status.result) ? status.result : null;

  if (status.state === 'done') {
    response.success = typeof result?.success === 'boolean' ? result.success : true;

    const aliasKeys = [
      'mp4_url',
      'srt_url',
      'tts_engine',
      'caption_timing_mode',
      'caption_alignment_mode',
      'timings',
    ] as const;

    for (const key of aliasKeys) {
      if (result && key in result) {
        response[key] = result[key];
      }
    }
  } else if (status.state === 'failed') {
    response.success = false;
    response.detail = status.error?.detail ?? null;
  } else {
    response.success = null;
  }

  return response;
}

export async function GET(request: NextRequest, context: RouteContext) {
  if (!isPodcastVideoAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureRunningJobRecovery();

  const { jobId } = await context.params;
  const status = await readStatus(jobId);
  if (!status) {
    return NextResponse.json(
      { error: 'Podcast Film job status not found.', job_id: jobId },
      {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }

  return NextResponse.json(buildStatusResponse(status), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
