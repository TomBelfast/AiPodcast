import { NextRequest, NextResponse } from 'next/server';

// GET - Test MinIO connection
export async function GET(req: NextRequest) {
  try {
    // Dynamic import for MinIO
    const minioModule = await import('minio');
    const MinIO = minioModule.default || minioModule;
    
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
    const accessKey = req.nextUrl.searchParams.get('accessKey') || process.env.MINIO_ACCESS_KEY || 'login';
    const secretKey = req.nextUrl.searchParams.get('secretKey') || process.env.MINIO_SECRET_KEY || 'Swiat1976';
    const bucketName = process.env.MINIO_BUCKET_NAME || 'podcast';

    console.log('Testing MinIO connection:', {
      endPoint,
      port,
      useSSL,
      bucketName,
      accessKey: accessKey.substring(0, 3) + '***', // Don't log full key
    });

    const minioClient = new MinIO.Client({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });

    // Test 1: List buckets
    let buckets: string[] = [];
    try {
      buckets = await minioClient.listBuckets();
      console.log('Buckets found:', buckets.map(b => b.name));
    } catch (error: any) {
      return NextResponse.json({
        success: false,
        error: 'Failed to list buckets',
        details: error.message,
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
    } catch (error: any) {
      return NextResponse.json({
        success: false,
        error: `Failed to check/create bucket: ${bucketName}`,
        details: error.message,
        buckets: buckets.map(b => b.name),
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
    } catch (error: any) {
      return NextResponse.json({
        success: false,
        error: 'Failed to upload test file',
        details: error.message,
        bucketExists,
        buckets: buckets.map(b => b.name),
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
      buckets: buckets.map(b => b.name),
      bucketExists,
      uploadTest: {
        success: uploadSuccess,
        presignedUrlGenerated: !!presignedUrl,
      },
    });
  } catch (error: any) {
    console.error('MinIO test error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to connect to MinIO',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    }, { status: 500 });
  }
}

