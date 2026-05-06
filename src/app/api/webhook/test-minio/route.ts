import { NextRequest, NextResponse } from 'next/server';

function errorDetails(error: unknown): { message: string; stack?: string } {
  return {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
}

// GET - Test MinIO connection
export async function GET(req: NextRequest) {
  try {
    // Dynamic import for MinIO
    const { Client } = await import('minio');
    
    // Parse endpoint - Nginx proxies external address to internal port 9002
    let endPoint = process.env.MINIO_ENDPOINT || 'minio2-api.aihub.ovh';
    let port = parseInt(process.env.MINIO_PORT || '443');
    let useSSL = process.env.MINIO_USE_SSL === 'true' || endPoint.includes('https://') || port === 443;

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
    }

    // Use provided credentials or environment variables
    const accessKey = req.nextUrl.searchParams.get('accessKey') || process.env.MINIO_ACCESS_KEY;
    const secretKey = req.nextUrl.searchParams.get('secretKey') || process.env.MINIO_SECRET_KEY;
    const bucketName = process.env.MINIO_BUCKET_NAME || 'podcast';

    if (!accessKey || !secretKey) {
      return NextResponse.json({
        success: false,
        error: 'MinIO credentials are missing. Set MINIO_ACCESS_KEY and MINIO_SECRET_KEY.',
      }, { status: 500 });
    }

    console.log('Testing MinIO connection:', {
      endPoint,
      port,
      useSSL,
      bucketName,
      accessKey: accessKey.substring(0, 3) + '***', // Don't log full key
    });

    const minioClient = new Client({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });

    // Test 1: List buckets
    let buckets: unknown[] = [];
    try {
      buckets = await minioClient.listBuckets();
      console.log('Buckets found:', buckets);
    } catch (error: unknown) {
      const details = errorDetails(error);
      return NextResponse.json({
        success: false,
        error: 'Failed to list buckets',
        details: details.message,
        connection: {
          endPoint,
          port,
          useSSL,
        },
      }, { status: 500 });
    }

    // Test 2: Check if bucket exists, create if not
    let bucketExists = false;
    try {
      bucketExists = await minioClient.bucketExists(bucketName);
      if (!bucketExists) {
        await minioClient.makeBucket(bucketName, 'us-east-1');
        bucketExists = true;
        console.log(`Bucket ${bucketName} created successfully`);
      }
    } catch (error: unknown) {
      const details = errorDetails(error);
      return NextResponse.json({
        success: false,
        error: `Failed to check/create bucket: ${bucketName}`,
        details: details.message,
        buckets,
      }, { status: 500 });
    }

    // Test 3: Try to upload a test file
    const testContent = Buffer.from('test file content');
    const testFileName = `test_${Date.now()}.txt`;
    let uploadSuccess = false;
    let presignedUrl: string | null = null;

    try {
      await minioClient.putObject(bucketName, testFileName, testContent, testContent.length, {
        'Content-Type': 'text/plain',
      });
      uploadSuccess = true;
      console.log('Test file uploaded successfully');

      // Generate presigned URL
      presignedUrl = await minioClient.presignedGetObject(bucketName, testFileName, 3600);
      console.log('Presigned URL generated');

      // Clean up test file
      await minioClient.removeObject(bucketName, testFileName);
      console.log('Test file removed');
    } catch (error: unknown) {
      const details = errorDetails(error);
      return NextResponse.json({
        success: false,
        error: 'Failed to upload test file',
        details: details.message,
        bucketExists,
        buckets,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'MinIO connection successful!',
      connection: {
        endPoint,
        port,
        useSSL,
        bucketName,
      },
      buckets,
      bucketExists,
      uploadTest: {
        success: uploadSuccess,
        presignedUrlGenerated: !!presignedUrl,
      },
    });
  } catch (error: unknown) {
    const details = errorDetails(error);
    console.error('MinIO test error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to connect to MinIO',
      details: details.message,
      stack: process.env.NODE_ENV === 'development' ? details.stack : undefined,
    }, { status: 500 });
  }
}
