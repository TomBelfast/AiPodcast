import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import {
  fileExists,
  getArtifactContentType,
  getArtifactPathByType,
} from '@/lib/podcast-video/archive';
import { isPodcastVideoAuthorized } from '@/lib/podcast-video/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseType(rawType: string | null): 'json' | 'mp3' | 'srt' | 'mp4' | null {
  if (rawType === 'json' || rawType === 'mp3' || rawType === 'srt' || rawType === 'mp4') {
    return rawType;
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    if (!isPodcastVideoAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const type = parseType(request.nextUrl.searchParams.get('type'));
    if (!type) {
      return NextResponse.json(
        { error: 'Query param type must be one of: json, mp3, srt, mp4.' },
        { status: 400 }
      );
    }

    const { jobId } = await params;
    const filePath = getArtifactPathByType(jobId, type);
    if (!(await fileExists(filePath))) {
      return NextResponse.json(
        { error: `Artifact ${type} not found for job ${jobId}.` },
        { status: 404 }
      );
    }

    const fileBuffer = await fs.readFile(filePath);
    const disposition = type === 'mp4' || type === 'mp3' ? 'inline' : 'attachment';

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Type': getArtifactContentType(type),
        'Content-Length': fileBuffer.length.toString(),
        'Content-Disposition': `${disposition}; filename="${jobId}.${type}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[podcast-video] failed to serve artifact:', error);
    return NextResponse.json(
      { error: 'Failed to serve podcast video artifact.' },
      { status: 500 }
    );
  }
}
