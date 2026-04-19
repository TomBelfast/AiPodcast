import { NextRequest, NextResponse } from 'next/server';
import { isPodcastVideoAuthorized } from '@/lib/podcast-video/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OMNIVOICE_BASE_URL =
  process.env.OMNIVOICE_BASE_URL?.trim() || 'http://192.168.0.13:8766';
const CACHE_TTL_MS = 5 * 60 * 1000;

type UpstreamVoice = {
  id: string;
  label: string;
  gender: string;
  language: string;
  aliases: string[];
  default_image_folder: string;
};

type CacheEntry = { fetchedAt: number; payload: ResponseBody };
type ResponseBody = {
  source: string;
  fetched_at: string;
  count: number;
  voices: UpstreamVoice[];
  by_gender: { female: UpstreamVoice[]; male: UpstreamVoice[]; other: UpstreamVoice[] };
};

// Survive Next.js hot reload by stashing the cache on globalThis.
const cacheHolder = globalThis as unknown as { __omniVoiceCache?: CacheEntry };

async function loadVoices(force: boolean): Promise<ResponseBody> {
  const now = Date.now();
  if (!force && cacheHolder.__omniVoiceCache && now - cacheHolder.__omniVoiceCache.fetchedAt < CACHE_TTL_MS) {
    return cacheHolder.__omniVoiceCache.payload;
  }

  const res = await fetch(`${OMNIVOICE_BASE_URL}/voices`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`OmniVoice /voices returned ${res.status}`);
  }
  const data = (await res.json()) as { voices?: UpstreamVoice[] };
  const voices = Array.isArray(data.voices) ? data.voices : [];

  const by_gender = { female: [] as UpstreamVoice[], male: [] as UpstreamVoice[], other: [] as UpstreamVoice[] };
  for (const v of voices) {
    const g = (v.gender || '').toLowerCase();
    if (g === 'female') by_gender.female.push(v);
    else if (g === 'male') by_gender.male.push(v);
    else by_gender.other.push(v);
  }

  const payload: ResponseBody = {
    source: `${OMNIVOICE_BASE_URL}/voices`,
    fetched_at: new Date(now).toISOString(),
    count: voices.length,
    voices,
    by_gender,
  };
  cacheHolder.__omniVoiceCache = { fetchedAt: now, payload };
  return payload;
}

export async function GET(request: NextRequest) {
  if (!isPodcastVideoAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const force = request.nextUrl.searchParams.get('refresh') === '1';
  try {
    const payload = await loadVoices(force);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to fetch OmniVoice voice registry.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}
