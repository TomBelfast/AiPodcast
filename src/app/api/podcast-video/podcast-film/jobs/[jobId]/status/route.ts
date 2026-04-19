import { NextRequest, NextResponse } from 'next/server';
import { isPodcastVideoAuthorized } from '@/lib/podcast-video/http';
import { readStatus } from '@/lib/podcast-video/job-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  if (!isPodcastVideoAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  return NextResponse.json(status, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
