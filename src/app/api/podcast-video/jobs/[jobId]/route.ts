import { NextRequest, NextResponse } from 'next/server';
import {
  evictPodcastVideoJob,
  getPodcastVideoJob,
  getPodcastVideoJobAvailability,
  toClientPodcastVideoJob,
} from '@/lib/podcast-video/jobs';
import {
  deletePersistedPodcastVideoJob,
  isPersistedPodcastVideoJobBusy,
} from '@/lib/podcast-video/history';
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    if (!isPodcastVideoAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId } = await params;
    if (await isPersistedPodcastVideoJobBusy(jobId)) {
      return NextResponse.json(
        { error: 'Cannot delete a queued or running podcast video job.' },
        { status: 409 }
      );
    }

    const deleted = await deletePersistedPodcastVideoJob(jobId);
    evictPodcastVideoJob(jobId);

    if (!deleted) {
      return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      deleted: true,
      jobId,
    });
  } catch (error) {
    console.error('[podcast-video] failed to delete job:', error);
    return NextResponse.json(
      { error: 'Failed to delete podcast video job.' },
      { status: 500 }
    );
  }
}
