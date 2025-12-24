import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const ARCHIVE_DIR = path.join(process.cwd(), 'archive');

// Ensure archive directory exists
async function ensureArchiveDir() {
  try {
    await fs.access(ARCHIVE_DIR);
  } catch {
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  }
}

// GET - List all archived files
export async function GET() {
  try {
    await ensureArchiveDir();
    const files = await fs.readdir(ARCHIVE_DIR);
    
    const fileList = await Promise.all(
      files
        .filter(file => file.endsWith('.mp3'))
        .map(async (file) => {
          const filePath = path.join(ARCHIVE_DIR, file);
          const stats = await fs.stat(filePath);
          return {
            name: file,
            size: stats.size,
            createdAt: stats.birthtime,
            modifiedAt: stats.mtime,
          };
        })
    );
    
    // Sort by creation date, newest first
    fileList.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    
    return NextResponse.json({ files: fileList });
  } catch (error) {
    console.error('Error listing archive files:', error);
    return NextResponse.json(
      { error: 'Failed to list archive files' },
      { status: 500 }
    );
  }
}

// POST - Save a file to archive
export async function POST(req: NextRequest) {
  try {
    await ensureArchiveDir();
    const { audioBase64, title, conversation } = await req.json();
    
    if (!audioBase64) {
      return NextResponse.json(
        { error: 'Audio data is required' },
        { status: 400 }
      );
    }
    
    // Extract base64 data
    const base64Data = audioBase64.includes(',') 
      ? audioBase64.split(',')[1] 
      : audioBase64;
    
    // Convert base64 to buffer
    const audioBuffer = Buffer.from(base64Data, 'base64');
    
    // Generate filename with timestamp
    const timestamp = Date.now();
    const safeTitle = title 
      ? title.replace(/[^a-z0-9]/gi, '_').substring(0, 50)
      : 'podcast';
    const filename = `${safeTitle}_${timestamp}.mp3`;
    const filePath = path.join(ARCHIVE_DIR, filename);
    
    // Save audio file
    await fs.writeFile(filePath, audioBuffer);
    
    // Save metadata (conversation, title, etc.)
    const metadataPath = path.join(ARCHIVE_DIR, `${safeTitle}_${timestamp}.json`);
    await fs.writeFile(
      metadataPath,
      JSON.stringify({
        title: title || 'Untitled Podcast',
        conversation,
        createdAt: new Date().toISOString(),
        audioFile: filename,
      }, null, 2)
    );
    
    return NextResponse.json({
      success: true,
      filename,
      message: 'File archived successfully',
    });
  } catch (error) {
    console.error('Error archiving file:', error);
    return NextResponse.json(
      { error: 'Failed to archive file' },
      { status: 500 }
    );
  }
}

// DELETE - Delete an archived file
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filename = searchParams.get('filename');
    
    if (!filename) {
      return NextResponse.json(
        { error: 'Filename is required' },
        { status: 400 }
      );
    }
    
    // Security: prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return NextResponse.json(
        { error: 'Invalid filename' },
        { status: 400 }
      );
    }
    
    const filePath = path.join(ARCHIVE_DIR, filename);
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }
    
    // Delete the file
    await fs.unlink(filePath);
    
    // Also try to delete metadata file if it exists
    const metadataPath = filePath.replace('.mp3', '.json');
    try {
      await fs.unlink(metadataPath);
    } catch {
      // Metadata file might not exist, that's okay
    }
    
    return NextResponse.json({
      success: true,
      message: 'File deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting archive file:', error);
    return NextResponse.json(
      { error: 'Failed to delete file' },
      { status: 500 }
    );
  }
}

