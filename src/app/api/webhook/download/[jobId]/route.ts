import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const ARCHIVE_DIR = path.join(process.cwd(), 'archive');

// GET - Download audio file by jobId
export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const jobId = params.jobId;

    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      );
    }

    // Find file by jobId in archive directory
    // Files are named with jobId in the filename
    const files = await fs.readdir(ARCHIVE_DIR);
    const matchingFile = files.find(file => file.includes(jobId) && file.endsWith('.mp3'));

    if (!matchingFile) {
      return NextResponse.json(
        { error: 'File not found for this job ID' },
        { status: 404 }
      );
    }

    const filePath = path.join(ARCHIVE_DIR, matchingFile);

    // Read file
    const fileBuffer = await fs.readFile(filePath);

    // Return file with appropriate headers
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': `attachment; filename="${matchingFile}"`,
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Error serving file:', error);
    return NextResponse.json(
      { error: 'Failed to serve file' },
      { status: 500 }
    );
  }
}

