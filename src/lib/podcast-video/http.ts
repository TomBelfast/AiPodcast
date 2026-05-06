import type { NextRequest } from 'next/server';

function tryGetHost(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

export function resolvePublicBaseUrl(request: NextRequest): string {
  const envBase =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_BASE_URL?.trim();
  if (envBase) {
    return envBase.replace(/\/+$/, '');
  }

  return resolveRequestBaseUrl(request);
}

export function resolveRequestBaseUrl(
  request: Pick<NextRequest, 'headers'>
): string {
  const host =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    '127.0.0.1:3300';
  const proto =
    request.headers.get('x-forwarded-proto') ||
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'http');

  return `${proto}://${host}`.replace(/\/+$/, '');
}

export function isPodcastVideoAuthorized(request: NextRequest): boolean {
  const expectedApiKey = process.env.APP_API_KEY?.trim();
  if (!expectedApiKey) {
    return true;
  }

  const headerApiKey = request.headers.get('x-api-key')?.trim();
  if (headerApiKey && headerApiKey === expectedApiKey) {
    return true;
  }

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const originHost = tryGetHost(request.headers.get('origin'));
  const refererHost = tryGetHost(request.headers.get('referer'));

  return Boolean(host && (originHost === host || refererHost === host));
}
