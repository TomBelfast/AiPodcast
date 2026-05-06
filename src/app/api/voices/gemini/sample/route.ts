import { promises as fs } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { createGeminiDialogue } from '@/actions/gemini-tts';
import { getEffectiveAdminSettings } from '@/lib/admin-settings';
import {
  collectCandidateObjects,
  findNestedObject,
  isPlainObject,
  normalizeGeminiStyle,
  normalizeGeminiTempo,
  pickString,
} from '@/lib/podcast/contracts';
import { GEMINI_VOICE_OPTIONS } from '@/lib/voice-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SAMPLE_CACHE_VERSION = 'v1';
const SAMPLE_CACHE_DIR = path.join(process.cwd(), 'archive', 'voice-samples', 'gemini');

function normalizeLanguageCode(value: string | null): string {
  return String(value || 'pl')
    .trim()
    .toLowerCase()
    .replace('_', '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 16) || 'pl';
}

function safeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'voice';
}

function wavToDataUrl(buffer: Buffer): string {
  return `data:audio/wav;base64,${buffer.toString('base64')}`;
}

function dataUrlToWavBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  return Buffer.from(base64, 'base64');
}

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

function isTrustedAppRequest(request: NextRequest): boolean {
  const expectedApiKey = process.env.APP_API_KEY?.trim();
  const headerApiKey = request.headers.get('x-api-key')?.trim();
  if (expectedApiKey && headerApiKey === expectedApiKey) {
    return true;
  }

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const hostname = host?.split(':')[0].toLowerCase();
  const originHost = tryGetHost(request.headers.get('origin'));
  const refererHost = tryGetHost(request.headers.get('referer'));

  return Boolean(
    host &&
      (originHost === host ||
        refererHost === host ||
        hostname === 'localhost' ||
        hostname === '127.0.0.1')
  );
}

function buildSampleText(language: string, voiceName: string): string {
  if (language.startsWith('en')) {
    return `Hello, I am the ${voiceName} voice. This is a short podcast voice preview.`;
  }

  if (language.startsWith('de')) {
    return `Hallo, ich bin die Stimme ${voiceName}. Das ist eine kurze Podcast-Stimmprobe.`;
  }

  if (language.startsWith('fr')) {
    return `Bonjour, je suis la voix ${voiceName}. Voici un court aperçu vocal pour le podcast.`;
  }

  return `Cześć, jestem głosem ${voiceName}. To krótka próbka brzmienia do podcastu.`;
}

export async function POST(request: NextRequest) {
  try {
    const parsedBody = await request.json().catch(() => null);
    if (!isPlainObject(parsedBody)) {
      return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }

    const candidates = collectCandidateObjects(parsedBody);
    const ttsConfig = findNestedObject(parsedBody, 'tts');
    const ttsCandidates = ttsConfig ? [...candidates, ttsConfig] : candidates;
    const rawVoiceId =
      pickString(ttsCandidates, ['voiceId', 'voice_id', 'voice', 'voice1']) || '';
    const voice = GEMINI_VOICE_OPTIONS.find(
      (option) => option.id.toLowerCase() === rawVoiceId.toLowerCase()
    );

    if (!voice) {
      return NextResponse.json(
        { error: 'Unknown Gemini voice.', availableVoices: GEMINI_VOICE_OPTIONS.map((option) => option.id) },
        { status: 400 }
      );
    }

    const language = normalizeLanguageCode(pickString(ttsCandidates, ['language', 'lang', 'locale']));
    const geminiStyle = normalizeGeminiStyle(
      pickString(ttsCandidates, ['geminiStyle', 'gemini_style', 'style'])
    );
    const geminiTempo = normalizeGeminiTempo(
      pickString(ttsCandidates, ['geminiTempo', 'gemini_tempo', 'tempo'])
    );
    const explicitApiKey =
      pickString(ttsCandidates, ['apiKey', 'api_key', 'geminiApiKey', 'gemini_api_key']) || '';
    const trustedAppRequest = isTrustedAppRequest(request);

    if (!trustedAppRequest && !explicitApiKey) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const filename = [
      SAMPLE_CACHE_VERSION,
      safeFilenamePart(language),
      safeFilenamePart(voice.id),
      safeFilenamePart(geminiStyle),
      safeFilenamePart(geminiTempo),
    ].join('_') + '.wav';
    const filePath = path.join(SAMPLE_CACHE_DIR, filename);

    try {
      const cachedAudio = await fs.readFile(filePath);
      return NextResponse.json({
        provider: 'gemini',
        voiceId: voice.id,
        voiceName: voice.name,
        language,
        geminiStyle,
        geminiTempo,
        cached: true,
        mimeType: 'audio/wav',
        filename,
        audioBase64: wavToDataUrl(cachedAudio),
      });
    } catch {
      // Cache miss: generate below.
    }

    const apiKey =
      explicitApiKey || (trustedAppRequest ? getEffectiveAdminSettings().gemini_api_key : '') || '';
    if (!apiKey) {
      return NextResponse.json(
        {
          error: 'Gemini API key is not configured for voice samples.',
          code: 'MISSING_GEMINI_KEY',
        },
        { status: 403 }
      );
    }

    const result = await createGeminiDialogue({
      inputs: [
        {
          text: buildSampleText(language, voice.name),
          voiceId: voice.id,
          speaker: 'Speaker1',
        },
      ],
      provider: 'gemini',
      language,
      apiKey,
      geminiStyle,
      geminiTempo,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    if (!result.value.audioBase64) {
      return NextResponse.json({ error: 'Gemini returned no sample audio.' }, { status: 500 });
    }

    const wavBuffer = dataUrlToWavBuffer(result.value.audioBase64);
    await fs.mkdir(SAMPLE_CACHE_DIR, { recursive: true });
    await fs.writeFile(filePath, wavBuffer);

    return NextResponse.json({
      provider: 'gemini',
      voiceId: voice.id,
      voiceName: voice.name,
      language,
      geminiStyle,
      geminiTempo,
      cached: false,
      mimeType: 'audio/wav',
      filename,
      processingTimeMs: result.value.processingTimeMs,
      audioBase64: wavToDataUrl(wavBuffer),
    });
  } catch (error) {
    console.error('Gemini voice sample error:', error);
    return NextResponse.json({ error: 'Failed to generate Gemini voice sample.' }, { status: 500 });
  }
}
