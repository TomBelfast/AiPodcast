import { NextRequest, NextResponse } from 'next/server';
import { createDialogue } from '@/actions/dialogue';
import { CreateDialogueRequest } from '@/types';
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

// POST - Approve conversation and generate audio
export async function POST(req: NextRequest) {
  try {
    const { jobId, conversation, title, voice1, voice2, uploadToMinIO } = await req.json();

    if (!conversation || !Array.isArray(conversation) || conversation.length === 0) {
      return NextResponse.json(
        { error: 'Valid conversation is required' },
        { status: 400 }
      );
    }

    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      );
    }

    // Default voices if not provided
    const voice1Id = voice1 || 'FF7KdobWPaiR0vkcALHF';
    const voice2Id = voice2 || 'BpjGufoPiobT79j2vtj4';

    // Convert conversation to dialogue inputs
    const dialogueInputs = conversation.map((item: { speaker: string; text: string }) => ({
      text: item.text,
      voiceId: (item.speaker === 'Speaker1' || item.speaker === 'Antoni') ? voice1Id : voice2Id,
    }));

    // Generate audio with timestamps
    const dialogueRequest: CreateDialogueRequest = {
      inputs: dialogueInputs,
      includeTimestamps: true, // Always include timestamps for alignment data
    };

    const result = await createDialogue(dialogueRequest);

    if (!result.ok) {
      console.error('Error generating dialogue:', result.error);
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    const { audioBase64, voiceSegments, alignment, normalizedAlignment } = result.value;

    // Save file locally first
    await ensureArchiveDir();
    const base64Data = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
    const audioBuffer = Buffer.from(base64Data, 'base64');
    const safeTitle = (title || 'podcast').replace(/[^a-z0-9]/gi, '_').substring(0, 50);
    const audioFilename = `${safeTitle}_${jobId}.mp3`;
    const audioFilePath = path.join(ARCHIVE_DIR, audioFilename);
    const jsonFilename = `${safeTitle}_${jobId}.json`;
    const jsonFilePath = path.join(ARCHIVE_DIR, jsonFilename);

    await fs.writeFile(audioFilePath, audioBuffer);

    // Prepare raw metadata
    const rawMetadata = {
      jobId,
      title: title || 'Untitled Podcast',
      speakers: {
        Speaker1: { name: 'Speaker 1', voiceId: voice1Id, gender: 'male', personality: 'Energetic/Naive' },
        Speaker2: { name: 'Speaker 2', voiceId: voice2Id, gender: 'female', personality: 'Pessimistic/Arrogant' },
        Antoni: { name: 'Antoni', voiceId: voice1Id, gender: 'male', personality: 'Silesian/Energetic' },
        Zofia: { name: 'Zofia', voiceId: voice2Id, gender: 'female', personality: 'Goral/Pessimistic' }
      },
      conversation,
      voiceSegments: voiceSegments?.map(s => ({
        ...s,
        speaker: (s.voiceId === voice1Id) ? 'Antoni' : 'Zofia'
      })),
      alignment,
      normalizedAlignment,
      audioFilename,
      timestamp: new Date().toISOString()
    };

    // Parse to normalized Podcast AI format
    const { parseElevenLabsTranscript } = await import('@/lib/transcript-parser');
    const metadata = parseElevenLabsTranscript(rawMetadata);
    
    await fs.writeFile(jsonFilePath, JSON.stringify(metadata, null, 2));

    // Upload to MinIO if requested
    let minioUrl: string | null = null;
    let minioJsonUrl: string | null = null;

    if (uploadToMinIO) {
      try {
        console.log(`[Webhook Approve] Uploading audio to MinIO for JobID: ${jobId}`);
        const minioResult = await uploadToMinIOStorage(audioBase64, audioFilename, 'audio/mpeg');
        if (minioResult.success) {
          minioUrl = minioResult.url ?? null;
        }

        console.log(`[Webhook Approve] Uploading JSON transcript to MinIO for JobID: ${jobId}`);
        const jsonBase64 = Buffer.from(JSON.stringify(metadata)).toString('base64');
        const minioJsonResult = await uploadToMinIOStorage(jsonBase64, jsonFilename, 'application/json');
        if (minioJsonResult.success) {
          minioJsonUrl = minioJsonResult.url ?? null;
        }
      } catch (minioError) {
        console.error('Error uploading to MinIO:', minioError);
      }
    }

    // Return download URLs and the metadata
    const downloadUrl = minioUrl ||
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/webhook/download/${jobId}?type=audio`;
    const metadataUrl = minioJsonUrl ||
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/webhook/download/${jobId}?type=json`;

    return NextResponse.json({
      success: true,
      jobId,
      downloadUrl,
      metadataUrl,
      minioUrl,
      minioJsonUrl,
      filename: audioFilename,
      transcript: metadata,
      message: 'Audio and normalized transcript generated successfully',
    });
  } catch (error) {
    console.error('Error approving conversation:', error);
    return NextResponse.json(
      { error: 'Failed to generate audio' },
      { status: 500 }
    );
  }
}

// Helper function to upload to MinIO
async function uploadToMinIOStorage(
  base64Data: string,
  filename: string,
  contentType: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    // Dynamic import to avoid loading MinIO if not needed
    const minioModule = await import('minio');
    const MinIO = (minioModule as any).default || minioModule;

    // Check if MinIO is configured
    if (!process.env.MINIO_ACCESS_KEY || !process.env.MINIO_SECRET_KEY) {
      return {
        success: false,
        error: 'MinIO not configured. Set MINIO_ACCESS_KEY and MINIO_SECRET_KEY environment variables.',
      };
    }

    // Parse endpoint - support full URLs or separate config
    let endPoint = process.env.MINIO_ENDPOINT || 'minio2-api.aihub.ovh';
    let port = parseInt(process.env.MINIO_PORT || '443');
    let useSSL = process.env.MINIO_USE_SSL === 'true';

    // If endpoint contains protocol, extract hostname and port
    if (endPoint.includes('://')) {
      try {
        const url = new URL(endPoint);
        endPoint = url.hostname;
        port = url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80);
        useSSL = url.protocol === 'https:';
      } catch (e) {
        console.warn('Failed to parse MINIO_ENDPOINT as URL, using as-is:', e);
      }
    } else if (port === 443) {
      useSSL = true;
    }

    const minioClient = new MinIO.Client({
      endPoint,
      port,
      useSSL,
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
    });

    const bucketName = process.env.MINIO_BUCKET_NAME || 'podcast';

    // Ensure bucket exists
    const bucketExists = await minioClient.bucketExists(bucketName);
    if (!bucketExists) {
      await minioClient.makeBucket(bucketName, 'us-east-1');
    }

    // Set bucket policy to public read (if bucket is public)
    try {
      const publicPolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucketName}/*`],
          },
        ],
      };
      await minioClient.setBucketPolicy(bucketName, JSON.stringify(publicPolicy));
    } catch (policyError) {
      console.log(`Bucket policy setting skipped: ${(policyError as Error).message}`);
    }

    // Convert base64 to buffer
    const pureBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buffer = Buffer.from(pureBase64, 'base64');

    // Upload to MinIO
    await minioClient.putObject(bucketName, filename, buffer, buffer.length, {
      'Content-Type': contentType,
    });

    // Generate URL
    let url: string;
    try {
      const policy = await minioClient.getBucketPolicy(bucketName);
      const policyObj = JSON.parse(policy);
      const isPublic = policyObj.Statement?.some((stmt: any) =>
        stmt.Effect === 'Allow' && stmt.Principal?.AWS?.includes('*')
      );

      if (isPublic) {
        const protocol = useSSL ? 'https' : 'http';
        url = `${protocol}://${endPoint}:${port === 443 || port === 80 ? '' : port}/${bucketName}/${filename}`;
        // Fix potential double slash if port was omitted but colon remained
        url = url.replace(/([^:]\/)\/+/g, "$1");
      } else {
        url = await minioClient.presignedGetObject(bucketName, filename, 7 * 24 * 60 * 60);
      }
    } catch {
      const protocol = useSSL ? 'https' : 'http';
      const portPart = (port === 443 && useSSL) || (port === 80 && !useSSL) ? '' : `:${port}`;
      url = `${protocol}://${endPoint}${portPart}/${bucketName}/${filename}`;
    }

    return {
      success: true,
      url,
    };
  } catch (error: any) {
    console.error('MinIO upload error:', error);
    return {
      success: false,
      error: error.message || 'Failed to upload to MinIO',
    };
  }
}

