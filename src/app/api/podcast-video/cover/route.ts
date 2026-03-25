import { promises as fs } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { ensurePodcastVideoArchiveDir, fileExists } from '@/lib/podcast-video/archive';
import { getPodcastVideoCoverPath } from '@/lib/podcast-video/cover';
import { isPodcastVideoAuthorized } from '@/lib/podcast-video/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_COVER_FILE_SIZE = 10 * 1024 * 1024;

function getCoverContentType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

export async function GET(request: NextRequest) {
  try {
    if (!isPodcastVideoAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const coverPath = getPodcastVideoCoverPath();
    if (!(await fileExists(coverPath))) {
      return NextResponse.json(
        { error: `Podcast cover not found: ${coverPath}` },
        { status: 404 }
      );
    }

    const fileBuffer = await fs.readFile(coverPath);
    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Type': getCoverContentType(coverPath),
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'no-store',
        'Content-Disposition': `inline; filename="${path.basename(coverPath)}"`,
      },
    });
  } catch (error) {
    console.error('[podcast-video] failed to serve cover:', error);
    return NextResponse.json(
      { error: 'Failed to load podcast cover.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isPodcastVideoAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Form field "file" is required.' }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    const isPng = file.type === 'image/png' || fileName.endsWith('.png');
    if (!isPng) {
      return NextResponse.json(
        { error: 'Only PNG files are supported for the podcast cover.' },
        { status: 400 }
      );
    }

    if (file.size <= 0 || file.size > MAX_COVER_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Cover PNG must be between 1 byte and 10 MB.' },
        { status: 400 }
      );
    }

    const coverPath = getPodcastVideoCoverPath();
    await fs.mkdir(path.dirname(coverPath), { recursive: true });
    const coverBuffer = Buffer.from(await file.arrayBuffer());
    const tempPath = `${coverPath}.upload`;
    let backupPath: string | null = null;

    if (await fileExists(coverPath)) {
      const backupPaths = await ensurePodcastVideoArchiveDir('cover-backups');
      backupPath = path.join(
        backupPaths.dir,
        `podcast_cover_${new Date().toISOString().replace(/[:.]/g, '-')}.png`
      );
      await fs.copyFile(coverPath, backupPath);
    }

    await fs.writeFile(tempPath, coverBuffer);
    await fs.rename(tempPath, coverPath);

    return NextResponse.json({
      success: true,
      message: 'Podcast cover PNG updated successfully.',
      coverPath,
      backupPath,
      size: coverBuffer.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[podcast-video] failed to update cover:', error);
    return NextResponse.json(
      { error: 'Failed to update podcast cover PNG.' },
      { status: 500 }
    );
  }
}
