import { promises as fs } from 'fs';

function encodeObjectPath(objectName: string): string {
  return objectName
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function parseMinioConfig() {
  const accessKey = process.env.MINIO_ACCESS_KEY || '';
  const secretKey = process.env.MINIO_SECRET_KEY || '';
  const bucketName = process.env.MINIO_BUCKET_NAME || 'podcast';
  let endPoint = process.env.MINIO_ENDPOINT || 'minio2-api.aihub.ovh';
  let port = parseInt(process.env.MINIO_PORT || '443', 10);
  let useSSL = process.env.MINIO_USE_SSL === 'true';

  if (endPoint.includes('://')) {
    const parsed = new URL(endPoint);
    endPoint = parsed.hostname;
    port = parsed.port ? parseInt(parsed.port, 10) : parsed.protocol === 'https:' ? 443 : 80;
    useSSL = parsed.protocol === 'https:';
  } else if (port === 443) {
    useSSL = true;
  }

  return { accessKey, secretKey, bucketName, endPoint, port, useSSL };
}

function buildDirectObjectUrl(config: ReturnType<typeof parseMinioConfig>, objectName: string): string {
  const publicBase = process.env.MINIO_PUBLIC_BASE_URL?.trim();
  if (publicBase) {
    return `${publicBase.replace(/\/+$/, '')}/${config.bucketName}/${encodeObjectPath(objectName)}`;
  }

  const protocol = config.useSSL ? 'https' : 'http';
  const portPart =
    (config.useSSL && config.port === 443) || (!config.useSSL && config.port === 80)
      ? ''
      : `:${config.port}`;
  return `${protocol}://${config.endPoint}${portPart}/${config.bucketName}/${encodeObjectPath(objectName)}`;
}

export async function uploadBufferToMinio(
  buffer: Buffer,
  objectName: string,
  contentType: string
): Promise<string> {
  const config = parseMinioConfig();
  if (!config.accessKey || !config.secretKey) {
    throw new Error('MINIO_ACCESS_KEY or MINIO_SECRET_KEY is not configured.');
  }

  const { Client } = await import('minio');
  const client = new Client({
    endPoint: config.endPoint,
    port: config.port,
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
  });

  const bucketExists = await client.bucketExists(config.bucketName);
  if (!bucketExists) {
    await client.makeBucket(config.bucketName, 'us-east-1');
  }

  try {
    const publicPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${config.bucketName}/*`],
        },
      ],
    };
    await client.setBucketPolicy(config.bucketName, JSON.stringify(publicPolicy));
  } catch (error) {
    console.warn('MinIO public bucket policy skipped:', error);
  }

  await client.putObject(config.bucketName, objectName, buffer, buffer.length, {
    'Content-Type': contentType,
  });

  try {
    const policy = await client.getBucketPolicy(config.bucketName);
    const parsed = JSON.parse(policy) as {
      Statement?: Array<{
        Effect?: string;
        Principal?: { AWS?: string[] | string };
      }>;
    };
    const isPublic = parsed.Statement?.some((statement) => {
      const awsPrincipal = statement.Principal?.AWS;
      const allowsEveryone = Array.isArray(awsPrincipal)
        ? awsPrincipal.includes('*')
        : awsPrincipal === '*';
      return statement.Effect === 'Allow' && allowsEveryone;
    });

    if (isPublic) {
      return buildDirectObjectUrl(config, objectName);
    }
  } catch (error) {
    console.warn('Unable to inspect MinIO bucket policy, falling back to direct URL:', error);
  }

  return client.presignedGetObject(config.bucketName, objectName, 7 * 24 * 60 * 60);
}

export async function uploadFileToMinio(
  filePath: string,
  objectName: string,
  contentType: string
): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return uploadBufferToMinio(buffer, objectName, contentType);
}
