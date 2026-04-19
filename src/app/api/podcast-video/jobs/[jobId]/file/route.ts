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

function parseType(rawType: string | null): 'json' | 'mp3' | 'srt' | 'mp4' | 'stem1' | 'stem2' | 'segment' | null {
  const valid = ['json', 'mp3', 'srt', 'mp4', 'stem1', 'stem2', 'segment'];
  if (valid.includes(rawType || '')) {
    return rawType as any;
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const type = parseType(request.nextUrl.searchParams.get('type'));
    if (!type) {
      return NextResponse.json(
        { error: 'Query param type must be one of: json, mp3, srt, mp4, stem1, stem2, segment.' },
        { status: 400 }
      );
    }

    const name = request.nextUrl.searchParams.get('name') || undefined;
    const isMp4Segment = type === 'segment' && !!name && name.toLowerCase().endsWith('.mp4');
    const isPublicArtifact = type === 'mp4' || type === 'srt' || isMp4Segment;
    if (!isPublicArtifact && !isPodcastVideoAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId } = await params;
    const filePath = getArtifactPathByType(jobId, type, name);
    if (!(await fileExists(filePath))) {
      return NextResponse.json(
        { error: `Artifact ${type} not found for job ${jobId}.` },
        { status: 404 }
      );
    }

    const fileBuffer = await fs.readFile(filePath);
    const disposition = type === 'mp4' || type === 'mp3' || type === 'segment' || type.startsWith('stem') ? 'inline' : 'attachment';
    const finalFileName = name || `${jobId}.${type}`;
    const contentType = isMp4Segment ? 'video/mp4' : getArtifactContentType(type);

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length.toString(),
        'Content-Disposition': `${disposition}; filename="${finalFileName}"`,
        'Cache-Control': isPublicArtifact ? 'public, max-age=3600' : 'no-store',
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
