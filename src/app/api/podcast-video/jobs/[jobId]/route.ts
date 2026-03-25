import { NextRequest, NextResponse } from 'next/server';
import {
  getPodcastVideoJob,
  getPodcastVideoJobAvailability,
  toClientPodcastVideoJob,
} from '@/lib/podcast-video/jobs';
import { isPodcastVideoAuthorized } from '@/lib/podcast-video/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    if (!isPodcastVideoAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId } = await params;
    const job = await getPodcastVideoJob(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    }

    const availableArtifacts = await getPodcastVideoJobAvailability(jobId);
    return NextResponse.json({
      success: true,
      job: toClientPodcastVideoJob(job, availableArtifacts),
    });
  } catch (error) {
    console.error('[podcast-video] failed to fetch job status:', error);
    return NextResponse.json(
      { error: 'Failed to load podcast video job.' },
      { status: 500 }
    );
  }
}
