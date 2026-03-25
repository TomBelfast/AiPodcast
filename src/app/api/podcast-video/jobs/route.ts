import { NextRequest, NextResponse } from 'next/server';
import { createPodcastVideoJob, toClientPodcastVideoJob } from '@/lib/podcast-video/jobs';
import { resolveCaptionSettings } from '@/lib/podcast-video/nca';
import { runPodcastVideoJob } from '@/lib/podcast-video/orchestrator';
import { resolvePublicBaseUrl, isPodcastVideoAuthorized } from '@/lib/podcast-video/http';
import type { PodcastVideoJobRequest } from '@/lib/podcast-video/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildJobId(): string {
  return `podcast_video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

    const body = (await request.json()) as PodcastVideoJobRequest;
    const hasScriptText = Boolean(body.script_text?.trim());
    const hasConversation = Array.isArray(body.conversation) && body.conversation.length > 0;
    const hasTranscript = Boolean(body.transcript);

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
    const title = body.title?.trim() || 'Podcast Video';
    const language = body.language?.trim() || 'pl';
    const captionSettings = resolveCaptionSettings({
      style: body.style,
      font_size: body.font_size,
      line_color: body.line_color,
      word_color: body.word_color,
      outline_color: body.outline_color,
    });

    const job = await createPodcastVideoJob({
      jobId,
      title,
      language,
      sourceJobId: body.source_job_id || null,
      publicBaseUrl,
      captionSettings,
      inputSummary: {
        hasScriptText,
        hasConversation,
        hasTranscript,
        conversationCount: countConversationItems(body),
      },
    });

    runPodcastVideoJob(jobId, body).catch((error) => {
      console.error('[podcast-video] background job failed:', error);
    });

    return NextResponse.json(
      {
        success: true,
        job: toClientPodcastVideoJob(job),
        statusUrl: `${publicBaseUrl}/api/podcast-video/jobs/${jobId}`,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('[podcast-video] failed to create job:', error);
    return NextResponse.json(
      { error: 'Failed to create podcast video job.' },
      { status: 500 }
    );
  }
}
