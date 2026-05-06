import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { Agent, FormData as UndiciFormData, fetch as undiciFetch } from 'undici';
import { createDialogue } from '@/actions/dialogue';
import { createGeminiDialogue } from '@/actions/gemini-tts';
import { getEffectiveAdminSettings } from '@/lib/admin-settings';
import {
  normalizeGeminiStyle,
  normalizeGeminiTempo,
  normalizeAvatarProvider,
  normalizeConversationDraft,
  normalizeReviewMode,
  normalizeTtsProvider,
} from '@/lib/podcast/contracts';
import { generateConversationDraft } from '@/lib/podcast/generate';
import {
  isPodcastVideoAuthorized,
  resolvePublicBaseUrl,
  resolveRequestBaseUrl,
} from '@/lib/podcast-video/http';
import {
  ensurePodcastVideoArchiveDir,
  buildPodcastVideoFileUrl,
  getPodcastVideoJobPaths,
} from '@/lib/podcast-video/archive';
import {
  buildAssHeader,
  buildClassicAssFromCueGroups,
  buildClassicCueGroupsFromDisplayTokens,
  buildClassicCueGroupsFromTimedSegments,
  buildClassicPseudoCueGroupsFromTimedSegments,
  buildSegmentCaptionTimings,
  buildSrtFromCueGroups,
  escapeAssText,
  estimateSegmentWordTimings,
  formatAssTime,
  hexToAssColor,
  normalizeComparableToken,
  normalizeText,
  toCaptionCase,
  type CaptionStyle,
  type DirectClassicAlignmentMode,
  type DisplayToken,
} from '@/lib/podcast-video/podcast-film-captions';
import {
  ensureRunningJobRecovery,
  initStatus,
  setPhase,
  markDone,
  markFailed,
  readStatus,
} from '@/lib/podcast-video/job-status';
import {
  acquirePodcastFilmDockerLease,
  ensurePodcastFilmDockerContainersStarted,
  getPodcastFilmInfrastructureMaxRetries,
  restartPodcastFilmDockerContainers,
  runWithPodcastFilmInfrastructureRetries,
} from '@/lib/podcast-video/docker-lifecycle';
import {
  DEFAULT_ELEVENLABS_VOICES,
  DEFAULT_GEMINI_VOICES,
  GEMINI_VOICE_OPTIONS,
  type VoiceGenderBucket,
} from '@/lib/voice-catalog';

const OMNIVOICE_JOB_TIMEOUT_MS = 15 * 60 * 1000;
const WORKER_PROBE_TIMEOUT_MS = 2500;
const WORKER_READY_TIMEOUT_MS = readEnvNumber(
  process.env.PODCAST_FILM_WORKER_READY_TIMEOUT_MS,
  120000,
  5000
);
const WORKER_READY_POLL_MS = readEnvNumber(
  process.env.PODCAST_FILM_WORKER_READY_POLL_MS,
  3000,
  1000
);
const INTERNAL_GENERATE_PODCAST_TIMEOUT_MS = 8 * 60 * 1000;
const INTERNAL_GENERATE_PODCAST_ATTEMPT_TIMEOUT_MS = 150 * 1000;
const OPENAI_WHISPER_TIMEOUT_MS = 2 * 60 * 1000;
const OMNIVOICE_JOB_DISPATCHER = new Agent({
  headersTimeout: OMNIVOICE_JOB_TIMEOUT_MS,
  bodyTimeout: OMNIVOICE_JOB_TIMEOUT_MS,
  connectTimeout: 30 * 1000,
});
const WORKER_PROBE_DISPATCHER = new Agent({
  headersTimeout: WORKER_PROBE_TIMEOUT_MS,
  bodyTimeout: WORKER_PROBE_TIMEOUT_MS,
  connectTimeout: WORKER_PROBE_TIMEOUT_MS,
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OMNIVOICE_BASE_URL =
  process.env.OMNIVOICE_BASE_URL?.trim() || 'http://192.168.0.13:8766';
const SOULX_BASE_URL =
  process.env.SOULX_BASE_URL?.trim() || 'http://192.168.0.13:7002';
const GEMINI_FEMALE_AUDIO_TEMPO = 1.1;

type Segment = { speaker: string; text: string };
type TtsEngine = 'omnivoice' | 'gemini' | 'elevenlabs';
type VoiceEntry = {
  id: string;
  gender: string;
  default_image_folder: string;
  aliases: string[];
};
type RawBody = Record<string, unknown>;
type ConversationItem = { speaker: string; text: string };
type PipelineConfig = {
  conversation: unknown;
  transcript: string;
  language: string;
  voice1: string;
  voice2: string;
  ttsEngine: TtsEngine;
  geminiApiKey: string | null;
  geminiStyle: 'plain' | 'expressive-lite';
  geminiTempo: 'normal' | 'fast';
  elevenlabsApiKey: string | null;
  ttsModel: string | null;
  soulxModel: 'pro' | 'lite';
  avatarProvider: 'soulx';
  reviewMode: 'off' | 'pause_after_conversation';
  useFaceCrop: boolean;
  imageRotationSeed: number | null;
  pinnedImages: Record<string, string>;
  transition: 'none' | 'crossfade';
  transitionDuration: number;
  captionsMode: 'off' | 'burn';
  captionStyle: 'highlight' | 'classic' | 'off';
  captionFontSize: number;
  captionWordColor: string;
  captionLineColor: string;
  captionOutlineColor: string;
  captionMarginV: number;
  captionLanguage: string;
  title: string;
  firstFrameStyle: FirstFrameStyle;
};
type FirstFrameStyle = {
  titleSize: number;
  titleMarginX: number;
  titleOffsetY: number;
  titleColor: string;
  titleOutlineColor: string;
};
type PreparedPipelineInput = {
  segments: Segment[];
  voiceRegistry: Map<string, VoiceEntry>;
  voice1: string;
  voice2: string;
  maleVoice: string;
  femaleVoice: string;
  voicesSwapped: boolean;
};
type GeminiAudioSegment = {
  segment_id: string;
  speaker: string;
  audio_file: string;
  audio_path: string;
  audio_content_type: string;
  duration_seconds: number;
  start_time_seconds: number;
  end_time_seconds: number;
};
type GeminiSynthesisResult = {
  segments: GeminiAudioSegment[];
  elapsed_ms: number;
  model: string;
  caption_warning: string;
};
type WorkerProbeResult = {
  service: 'omnivoice' | 'omnivoice_assets' | 'soulx';
  ok: boolean;
  url: string;
  detail: string;
  status?: number;
};

function resolveDirectClassicAlignmentMode(ttsEngine: TtsEngine): DirectClassicAlignmentMode {
  const raw = String(process.env.PODCAST_FILM_DIRECT_CLASSIC_ALIGNMENT_MODE || '')
    .trim()
    .toLowerCase();
  if (raw === 'segment_cues' || raw === 'classic_pseudo_token') {
    return raw;
  }
  return ttsEngine === 'gemini' ? 'classic_pseudo_token' : 'segment_cues';
}

function buildClientTtsConfig(args: {
  provider: TtsEngine;
  voice1: string;
  voice2: string;
  model?: string | null;
  geminiStyle?: 'plain' | 'expressive-lite';
  geminiTempo?: 'normal' | 'fast';
}) {
  return {
    provider: args.provider,
    voice1: args.voice1,
    voice2: args.voice2,
    ...(args.model ? { model: args.model } : {}),
    ...(args.provider === 'gemini' ? {
      geminiStyle: args.geminiStyle || 'expressive-lite',
      geminiTempo: args.geminiTempo || 'fast',
    } : {}),
  };
}

class PipelineInputError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error ?? body.detail ?? 'Pipeline input failed.'));
    this.status = status;
    this.body = body;
  }
}

const GEMINI_VOICE_OPTIONS_BY_ID = new Map(
  GEMINI_VOICE_OPTIONS.map((voice) => [voice.id.toLowerCase(), voice])
);

function readEnvNumber(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.round(parsed));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNumberInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function normalizeHexColor(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : fallback;
}

const FIRST_FRAME_PREVIEW_SCALE = 2.56;
const FIRST_FRAME_TITLE_SCALE_X = 1.16;
const DEFAULT_FIRST_FRAME_TITLE_SIZE = 43;
const DEFAULT_FIRST_FRAME_STYLE: FirstFrameStyle = {
  titleSize: DEFAULT_FIRST_FRAME_TITLE_SIZE,
  titleMarginX: 18,
  titleOffsetY: 0,
  titleColor: '#25FF00',
  titleOutlineColor: '#050608',
};

function readFirstFrameTitleSize(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_FIRST_FRAME_TITLE_SIZE;
  }
  return readNumberInRange(value, DEFAULT_FIRST_FRAME_TITLE_SIZE, 28, 58);
}

function resolveFirstFrameStyle(value: unknown): FirstFrameStyle {
  if (!isPlainObject(value)) {
    return DEFAULT_FIRST_FRAME_STYLE;
  }

  return {
    titleSize: readFirstFrameTitleSize(value.titleSize ?? value.title_size),
    titleMarginX: readNumberInRange(
      value.titleMarginX ?? value.title_margin_x,
      DEFAULT_FIRST_FRAME_STYLE.titleMarginX,
      0,
      46
    ),
    titleOffsetY: readNumberInRange(
      value.titleOffsetY ?? value.title_offset_y,
      DEFAULT_FIRST_FRAME_STYLE.titleOffsetY,
      -120,
      120
    ),
    titleColor: normalizeHexColor(
      value.titleColor ?? value.title_color,
      DEFAULT_FIRST_FRAME_STYLE.titleColor
    ),
    titleOutlineColor: normalizeHexColor(
      value.titleOutlineColor ?? value.title_outline_color,
      DEFAULT_FIRST_FRAME_STYLE.titleOutlineColor
    ),
  };
}

function normalizeVoiceGender(value: string | undefined): VoiceGenderBucket {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'male' || normalized === 'm') {
    return 'male';
  }
  if (normalized === 'female' || normalized === 'f') {
    return 'female';
  }
  return 'unknown';
}

function getGeminiVoiceOption(value: string) {
  return GEMINI_VOICE_OPTIONS_BY_ID.get(String(value || '').trim().toLowerCase());
}

function inferRequestedVoiceGender(
  value: string,
  omnivoiceRegistry: Map<string, VoiceEntry> | null
): VoiceGenderBucket {
  const geminiVoice = getGeminiVoiceOption(value);
  if (geminiVoice) {
    return geminiVoice.genderBucket;
  }

  const omnivoiceVoice = omnivoiceRegistry?.get(String(value || '').trim().toLowerCase());
  if (omnivoiceVoice) {
    return normalizeVoiceGender(omnivoiceVoice.gender);
  }

  const normalized = normalizeSpeakerToken(value);
  if (normalized === 'hosta') {
    return 'female';
  }
  if (normalized === 'hostb') {
    return 'male';
  }

  return 'unknown';
}

function pickFallbackGeminiVoice(
  requestedGender: VoiceGenderBucket,
  position: 1 | 2
): string {
  if (requestedGender === 'female') {
    return DEFAULT_GEMINI_VOICES.voice2;
  }
  if (requestedGender === 'male') {
    return DEFAULT_GEMINI_VOICES.voice1;
  }
  return position === 1
    ? DEFAULT_GEMINI_VOICES.voice1
    : DEFAULT_GEMINI_VOICES.voice2;
}

function buildGeminiVoiceRegistry(voiceIds: string[]): Map<string, VoiceEntry> {
  const registry = new Map<string, VoiceEntry>();

  for (const rawVoiceId of voiceIds) {
    const voiceId = String(rawVoiceId || '').trim();
    if (!voiceId) {
      continue;
    }

    const geminiVoice = getGeminiVoiceOption(voiceId);
    const gender = geminiVoice?.genderBucket || 'unknown';
    const entry: VoiceEntry = {
      id: geminiVoice?.id || voiceId,
      gender,
      default_image_folder: gender === 'female' ? 'Woman' : 'Men',
      aliases: [voiceId],
    };

    registry.set(entry.id.toLowerCase(), entry);
    for (const alias of entry.aliases) {
      registry.set(String(alias).toLowerCase(), entry);
    }
  }

  return registry;
}

function buildDirectAvatarVoiceRegistry(args: {
  voice1: string;
  voice2: string;
  omnivoiceRegistry: Map<string, VoiceEntry> | null;
}): Map<string, VoiceEntry> {
  const registry = new Map<string, VoiceEntry>();
  const entries = [
    {
      id: args.voice1,
      gender:
        inferRequestedVoiceGender(args.voice1, args.omnivoiceRegistry) === 'female'
          ? 'female'
          : 'male',
      aliases: ['speaker1', 'antoni', 'host_a'],
    },
    {
      id: args.voice2,
      gender:
        inferRequestedVoiceGender(args.voice2, args.omnivoiceRegistry) === 'male'
          ? 'male'
          : 'female',
      aliases: ['speaker2', 'zofia', 'host_b'],
    },
  ] as const;

  for (const entry of entries) {
    const voiceId = String(entry.id || '').trim();
    if (!voiceId) {
      continue;
    }

    const voiceEntry: VoiceEntry = {
      id: voiceId,
      gender: entry.gender,
      default_image_folder: entry.gender === 'female' ? 'Woman' : 'Men',
      aliases: [voiceId, ...entry.aliases],
    };

    registry.set(voiceEntry.id.toLowerCase(), voiceEntry);
    for (const alias of voiceEntry.aliases) {
      registry.set(String(alias).toLowerCase(), voiceEntry);
    }
  }

  return registry;
}

function resolveGeminiVoiceSelection(
  rawVoice1: string,
  rawVoice2: string,
  omnivoiceRegistry: Map<string, VoiceEntry> | null
): {
  voice1: string;
  voice2: string;
  voiceRegistry: Map<string, VoiceEntry>;
  maleVoice: string;
  femaleVoice: string;
  voicesSwapped: boolean;
} {
  const explicitVoice1 = getGeminiVoiceOption(rawVoice1);
  const explicitVoice2 = getGeminiVoiceOption(rawVoice2);

  const inferredGender1 = inferRequestedVoiceGender(rawVoice1, omnivoiceRegistry);
  const inferredGender2 = inferRequestedVoiceGender(rawVoice2, omnivoiceRegistry);

  const voice1 = explicitVoice1?.id || pickFallbackGeminiVoice(inferredGender1, 1);
  const voice2 = explicitVoice2?.id || pickFallbackGeminiVoice(inferredGender2, 2);

  const voiceRegistry = buildGeminiVoiceRegistry([voice1, voice2]);
  const {
    maleVoice,
    femaleVoice,
    swapped: voicesSwapped,
  } = resolveGenderedVoicePair(voice1, voice2, voiceRegistry);

  return {
    voice1,
    voice2,
    voiceRegistry,
    maleVoice,
    femaleVoice,
    voicesSwapped,
  };
}

function resolvePodcastFilmGeminiApiKey(explicitKey?: string | null): string | null {
  const normalizedExplicit = String(explicitKey || '').trim();
  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  const adminSettings = getEffectiveAdminSettings();
  return String(adminSettings.gemini_api_key || '').trim() || null;
}

function resolvePodcastFilmElevenLabsApiKey(explicitKey?: string | null): string | null {
  const normalizedExplicit = String(explicitKey || '').trim();
  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  const adminSettings = getEffectiveAdminSettings();
  return String(adminSettings.elevenlabs_api_key || '').trim() || null;
}

function resolvePodcastFilmWhisperApiKey(): string | null {
  const envKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (envKey) {
    return envKey;
  }

  const adminSettings = getEffectiveAdminSettings();
  const settingsKey = String(adminSettings.openai_api_key || '').trim();
  if (settingsKey && !settingsKey.toLowerCase().startsWith('sk-or-')) {
    return settingsKey;
  }

  return null;
}

function normalizeConversationItems(conversation: unknown): ConversationItem[] {
  return normalizeConversationDraft(conversation);
}

function normalizeSpeakerToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function resolveVoiceForSpeaker(rawSpeaker: string, voice1: string, voice2: string): string {
  const speaker = normalizeSpeakerToken(rawSpeaker);

  if (
    speaker === 'speaker2' ||
    speaker === 'zofia' ||
    speaker === 'hostb' ||
    speaker === 'voice2' ||
    speaker === 'speakerb'
  ) {
    return voice2;
  }

  if (
    speaker === 'speaker1' ||
    speaker === 'antoni' ||
    speaker === 'hosta' ||
    speaker === 'voice1' ||
    speaker === 'speakera'
  ) {
    return voice1;
  }

  return voice1;
}

async function generateSegmentsFromRawText(
  transcript: string,
  title: string,
  language: string,
  maleVoice: string,
  femaleVoice: string,
  ttsEngine: TtsEngine,
  geminiStyle: 'plain' | 'expressive-lite',
  geminiTempo: 'normal' | 'fast',
  internalAppBaseUrl: string
): Promise<Segment[]> {
  const conversation = await generateConversationDraft({
    rawText: transcript,
    title,
    language,
    ttsProvider: ttsEngine === 'omnivoice' ? 'omnivoice' : ttsEngine,
    geminiStyle,
    geminiTempo,
    internalAppBaseUrl,
    timeoutMs: INTERNAL_GENERATE_PODCAST_TIMEOUT_MS,
    llmAttemptTimeoutMs: INTERNAL_GENERATE_PODCAST_ATTEMPT_TIMEOUT_MS,
  });
  return conversation.map((item) => ({
    speaker: resolveVoiceForSpeaker(item.speaker, maleVoice, femaleVoice),
    text: item.text,
  }));
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const payload = dataUrl.includes(',') ? dataUrl.split(',', 2)[1] : dataUrl;
  return Buffer.from(payload, 'base64');
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const details = [error.message];
    const errWithCause = error as Error & {
      cause?: unknown;
      code?: string;
      errno?: string | number;
    };
    if (errWithCause.code) {
      details.push(`code=${errWithCause.code}`);
    }
    if (errWithCause.errno !== undefined) {
      details.push(`errno=${String(errWithCause.errno)}`);
    }
    if (errWithCause.cause && errWithCause.cause !== error) {
      details.push(`cause=${describeError(errWithCause.cause)}`);
    }
    return details.join(' | ');
  }
  return String(error);
}

async function fetchJsonWithProbe(url: string): Promise<{
  ok: boolean;
  status: number;
  data: unknown;
  text: string;
}> {
  const res = await undiciFetch(url, {
    method: 'GET',
    dispatcher: WORKER_PROBE_DISPATCHER,
    signal: AbortSignal.timeout(WORKER_PROBE_TIMEOUT_MS),
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data, text };
}

async function probeOmniVoiceReadiness(): Promise<WorkerProbeResult> {
  const healthUrl = `${OMNIVOICE_BASE_URL}/health`;
  try {
    const health = await fetchJsonWithProbe(healthUrl);
    if (!health.ok) {
      return {
        service: 'omnivoice',
        ok: false,
        url: healthUrl,
        status: health.status,
        detail: `health returned HTTP ${health.status}`,
      };
    }
    if (!isPlainObject(health.data) || health.data.ok !== true) {
      return {
        service: 'omnivoice',
        ok: false,
        url: healthUrl,
        status: health.status,
        detail: `health payload missing ok=true: ${health.text.slice(0, 200)}`,
      };
    }
  } catch (error) {
    return {
      service: 'omnivoice',
      ok: false,
      url: healthUrl,
      detail: `health request failed: ${describeError(error)}`,
    };
  }

  const voicesUrl = `${OMNIVOICE_BASE_URL}/voices`;
  try {
    const voices = await fetchJsonWithProbe(voicesUrl);
    if (!voices.ok) {
      return {
        service: 'omnivoice',
        ok: false,
        url: voicesUrl,
        status: voices.status,
        detail: `voices returned HTTP ${voices.status}`,
      };
    }
    const list = isPlainObject(voices.data) && Array.isArray(voices.data.voices)
      ? voices.data.voices
      : null;
    if (!list || list.length === 0) {
      return {
        service: 'omnivoice',
        ok: false,
        url: voicesUrl,
        status: voices.status,
        detail: 'voices endpoint responded, but returned an empty registry',
      };
    }
    return {
      service: 'omnivoice',
      ok: true,
      url: voicesUrl,
      status: voices.status,
      detail: `ready (${list.length} voices visible)`,
    };
  } catch (error) {
    return {
      service: 'omnivoice',
      ok: false,
      url: voicesUrl,
      detail: `voices request failed: ${describeError(error)}`,
    };
  }
}

async function probeOmniVoiceAssetReadiness(): Promise<WorkerProbeResult> {
  const folders = ['Woman', 'Men'];
  for (const folder of folders) {
    const url = `${OMNIVOICE_BASE_URL}/images?folder=${encodeURIComponent(folder)}`;
    try {
      const res = await fetchJsonWithProbe(url);
      if (!res.ok) {
        return {
          service: 'omnivoice_assets',
          ok: false,
          url,
          status: res.status,
          detail: `images(${folder}) returned HTTP ${res.status}`,
        };
      }
      const files =
        isPlainObject(res.data) && Array.isArray(res.data.files) ? res.data.files : null;
      if (!files || files.length === 0) {
        return {
          service: 'omnivoice_assets',
          ok: false,
          url,
          status: res.status,
          detail: `images(${folder}) responded, but returned no files`,
        };
      }
    } catch (error) {
      return {
        service: 'omnivoice_assets',
        ok: false,
        url,
        detail: `images(${folder}) request failed: ${describeError(error)}`,
      };
    }
  }

  return {
    service: 'omnivoice_assets',
    ok: true,
    url: `${OMNIVOICE_BASE_URL}/images`,
    detail: 'ready (Woman and Men image folders visible)',
  };
}

async function probeSoulXReadiness(): Promise<WorkerProbeResult> {
  const candidates = [
    `${SOULX_BASE_URL}/health`,
    `${SOULX_BASE_URL}/openapi.json`,
    `${SOULX_BASE_URL}/`,
  ];

  const details: string[] = [];
  for (const url of candidates) {
    try {
      const res = await undiciFetch(url, {
        method: 'GET',
        dispatcher: WORKER_PROBE_DISPATCHER,
        signal: AbortSignal.timeout(WORKER_PROBE_TIMEOUT_MS),
      });
      if (res.ok) {
        return {
          service: 'soulx',
          ok: true,
          url,
          status: res.status,
          detail: `reachable via ${new URL(url).pathname || '/'}`,
        };
      }
      if (res.status === 404 || res.status === 405) {
        details.push(`${new URL(url).pathname || '/'} -> HTTP ${res.status}`);
        continue;
      }
      return {
        service: 'soulx',
        ok: false,
        url,
        status: res.status,
        detail: `probe returned HTTP ${res.status}`,
      };
    } catch (error) {
      details.push(`${new URL(url).pathname || '/'} -> ${describeError(error)}`);
      continue;
    }
  }

  return {
    service: 'soulx',
    ok: false,
    url: candidates[0],
    detail: `reachable endpoint not found (${details.join('; ')})`,
  };
}

async function runWorkerPreflightChecks(ttsEngine: TtsEngine): Promise<WorkerProbeResult[]> {
  if (ttsEngine === 'gemini' || ttsEngine === 'elevenlabs') {
    return Promise.all([probeOmniVoiceAssetReadiness(), probeSoulXReadiness()]);
  }
  return Promise.all([probeOmniVoiceReadiness(), probeSoulXReadiness()]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeFailedWorkerChecks(workerChecks: WorkerProbeResult[]): string {
  return workerChecks
    .filter((check) => !check.ok)
    .map((check) => `${check.service}: ${check.detail}`)
    .join(' | ');
}

async function waitForWorkerPreflightChecks(ttsEngine: TtsEngine): Promise<WorkerProbeResult[]> {
  const deadline = Date.now() + WORKER_READY_TIMEOUT_MS;
  let checks = await runWorkerPreflightChecks(ttsEngine);

  while (checks.some((check) => !check.ok) && Date.now() < deadline) {
    await delay(WORKER_READY_POLL_MS);
    checks = await runWorkerPreflightChecks(ttsEngine);
  }

  return checks;
}

async function restartPodcastFilmInfrastructure(cause: unknown): Promise<void> {
  const restart = await restartPodcastFilmDockerContainers();
  if (restart.enabled) {
    console.warn(`[podcast-film] Docker restart result: ${restart.detail}`);
  }
  if (restart.enabled && !restart.ok) {
    throw new Error(`Podcast-film Docker restart failed: ${restart.detail}`, {
      cause,
    });
  }
}

async function ensurePodcastFilmInfrastructureReadyAfterRestart(
  ttsEngine: TtsEngine,
  cause: unknown
): Promise<void> {
  const checks = await waitForWorkerPreflightChecks(ttsEngine);
  const detail = summarizeFailedWorkerChecks(checks);
  if (detail) {
    throw new Error(
      `Podcast-film worker preflight failed after Docker restart: ${detail}`,
      { cause }
    );
  }
}

function resolveGenderedVoicePair(
  voice1: string,
  voice2: string,
  registry: Map<string, VoiceEntry>
): { maleVoice: string; femaleVoice: string; swapped: boolean } {
  const g1 = registry.get(voice1.toLowerCase())?.gender?.toLowerCase() || '';
  const g2 = registry.get(voice2.toLowerCase())?.gender?.toLowerCase() || '';
  if (g1 === 'female' && g2 === 'male') {
    return { maleVoice: voice2, femaleVoice: voice1, swapped: true };
  }
  return { maleVoice: voice1, femaleVoice: voice2, swapped: false };
}

const BRACKETED_TAG_PATTERN = /\[[^\]]*\]/g;
const GEMINI_EXPRESSIVE_ALLOWED_INLINE_TAGS = new Set([
  '[laughing]',
  '[sigh]',
  '[uhm]',
  '[short pause]',
]);
const CAPTION_TECHNICAL_INLINE_TAGS = new Set([
  '[laughing]',
  '[sigh]',
  '[uhm]',
  '[short pause]',
]);

function stripTtsInlineTags(
  text: string,
  allowedBracketedTags: ReadonlySet<string> = new Set()
): string {
  return text
    .replace(BRACKETED_TAG_PATTERN, (tag) => {
      const normalizedTag = tag.trim().toLowerCase();
      return allowedBracketedTags.has(normalizedTag) ? ` ${normalizedTag} ` : ' ';
    })
    .replace(/\s*—\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripCaptionInlineTags(text: string): string {
  return text
    .replace(BRACKETED_TAG_PATTERN, (tag) => {
      const normalizedTag = tag.trim().toLowerCase();
      return CAPTION_TECHNICAL_INLINE_TAGS.has(normalizedTag) ? ' ' : ` ${tag} `;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTranscriptToSegments(
  transcript: string,
  voice1: string,
  voice2: string
): Segment[] {
  const segments: Segment[] = [];
  const regex = /\[Speaker_(\d+)\]\s*:\s*([\s\S]*?)(?=\[Speaker_\d+\]\s*:|$)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(transcript)) !== null) {
    const idx = match[1];
    const text = match[2].trim();
    if (!text) continue;
    const speaker = idx === '1' ? voice1 : voice2;
    segments.push({ speaker, text });
  }
  return segments;
}

function segmentsFromConversation(
  conversation: unknown,
  voice1: string,
  voice2: string
): Segment[] | null {
  if (!Array.isArray(conversation) || conversation.length === 0) return null;
  const out: Segment[] = [];
  for (const item of conversation) {
    if (!isPlainObject(item)) continue;
    const rawSpeaker =
      (item.speaker as string) ||
      (item.role as string) ||
      (item.name as string) ||
      '';
    const text = String(
      (item.text as string) || (item.content as string) || ''
    ).trim();
    if (!text) continue;
    const voiceId = resolveVoiceForSpeaker(rawSpeaker, voice1, voice2);
    out.push({ speaker: voiceId, text });
  }
  return out.length ? out : null;
}

async function fetchVoiceRegistry(): Promise<Map<string, VoiceEntry>> {
  const res = await fetch(`${OMNIVOICE_BASE_URL}/voices`);
  if (!res.ok) throw new Error(`voices registry fetch failed: ${res.status}`);
  const data = (await res.json()) as { voices?: VoiceEntry[] };
  const map = new Map<string, VoiceEntry>();
  for (const v of data.voices || []) {
    map.set(v.id.toLowerCase(), v);
    for (const a of v.aliases || []) map.set(String(a).toLowerCase(), v);
  }
  return map;
}

async function fetchVoiceRegistryOptional(timeoutMs = 2500): Promise<Map<string, VoiceEntry> | null> {
  try {
    const res = await fetch(`${OMNIVOICE_BASE_URL}/voices`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { voices?: VoiceEntry[] };
    const map = new Map<string, VoiceEntry>();
    for (const v of data.voices || []) {
      map.set(v.id.toLowerCase(), v);
      for (const a of v.aliases || []) {
        map.set(String(a).toLowerCase(), v);
      }
    }
    return map;
  } catch {
    return null;
  }
}

async function fetchImageList(folder: string): Promise<string[]> {
  const res = await fetch(
    `${OMNIVOICE_BASE_URL}/images?folder=${encodeURIComponent(folder)}`
  );
  if (!res.ok)
    throw new Error(`images list ${folder} failed: ${res.status}`);
  const data = (await res.json()) as { files?: string[] };
  return data.files || [];
}

function pickImage(
  voice: VoiceEntry,
  cursors: Map<string, number>,
  snapshots: Map<string, string[]>,
  pinned: Record<string, string>
): { folder: string; file: string } {
  const folder = voice.default_image_folder.replace(/\/$/, '');
  const files = snapshots.get(folder);
  if (!files || files.length === 0) {
    throw new Error(`No images in folder ${folder} for voice ${voice.id}`);
  }
  const pinnedFile = pinned[voice.id] || pinned[voice.id.toLowerCase()];
  if (pinnedFile) {
    if (!files.includes(pinnedFile)) {
      throw new Error(
        `Pinned image "${pinnedFile}" not in folder ${folder} for voice ${voice.id}`
      );
    }
    return { folder, file: pinnedFile };
  }
  const cur = cursors.get(folder) ?? 0;
  const file = files[cur % files.length];
  cursors.set(folder, cur + 1);
  return { folder, file };
}

async function fetchBytes(
  url: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    buffer: buf,
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}

function bufferToBlobPart(buffer: Buffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes.buffer;
}

async function runFfmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => (stdout += c.toString()));
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-600)}`));
    });
  });
}

type SafeMp4MetadataValue = string | number | boolean | null | undefined;

function sanitizeMp4MetadataValue(value: SafeMp4MetadataValue): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[\r\n]+/g, ' ').trim();
  if (!text) return null;
  return text.slice(0, 500);
}

async function writeSafeMp4GenerationMetadata(
  mp4Path: string,
  metadata: Record<string, SafeMp4MetadataValue>
): Promise<{ elapsed_ms: number; metadata_count: number }> {
  const entries = Object.entries(metadata)
    .map(([key, value]) => [key, sanitizeMp4MetadataValue(value)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null);

  if (entries.length === 0) {
    return { elapsed_ms: 0, metadata_count: 0 };
  }

  const startedAt = Date.now();
  const tmpPath = mp4Path.replace(/\.mp4$/i, '') + '.metadata.mp4';
  const metadataArgs = entries.flatMap(([key, value]) => ['-metadata', `${key}=${value}`]);

  try {
    await runFfmpeg([
      '-y',
      '-i', mp4Path,
      '-map', '0',
      '-c', 'copy',
      '-movflags', '+faststart+use_metadata_tags',
      ...metadataArgs,
      tmpPath,
    ]);
    await fs.rename(tmpPath, mp4Path);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => {});
    throw error;
  }

  return { elapsed_ms: Date.now() - startedAt, metadata_count: entries.length };
}

type WhisperWord = { text: string; start: number; end: number };

const DIALECT_EQUIVALENT_GROUPS = [
  ['jo', 'ja'],
  ['mo', 'ma'],
  ['mosz', 'masz'],
  ['mom', 'mam'],
  ['tyz', 'tez'],
  ['niy', 'nie'],
  ['kiebys', 'kiedys', 'gdybys'],
  ['godom', 'gadam'],
  ['goda', 'gada'],
  ['godajom', 'gadaja'],
  ['bydzie', 'bedzie'],
  ['bydymy', 'bedziemy'],
  ['idymy', 'idziemy'],
  ['widza', 'widze'],
  ['czyto', 'czyta'],
  ['naso', 'nasza'],
] as const;

const DIALECT_EQUIVALENTS = new Map<string, Set<string>>();
for (const group of DIALECT_EQUIVALENT_GROUPS) {
  for (const token of group) {
    const equivalents = DIALECT_EQUIVALENTS.get(token) || new Set<string>();
    for (const other of group) {
      if (other !== token) {
        equivalents.add(other);
      }
    }
    DIALECT_EQUIVALENTS.set(token, equivalents);
  }
}

function makeComparableTokenVariants(value: string): string[] {
  const normalized = normalizeComparableToken(value);
  const splitVariants = normalized.split(/[\/|]+/);
  const compacted = [normalized, ...splitVariants]
    .map((candidate) => candidate.replace(/[^0-9a-z]+/g, ''))
    .filter(Boolean);
  return Array.from(new Set(compacted));
}

function areDialectEquivalent(a: string, b: string): boolean {
  return DIALECT_EQUIVALENTS.get(a)?.has(b) === true;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost
      );
    }
    for (let j = 0; j <= b.length; j++) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function scoreComparableTokens(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (areDialectEquivalent(a, b)) return 0.94;

  const minLength = Math.min(a.length, b.length);
  const maxLength = Math.max(a.length, b.length);
  if (minLength >= 4 && (a.includes(b) || b.includes(a))) {
    return 0.88;
  }
  if (minLength <= 2) {
    return 0;
  }

  const distance = levenshteinDistance(a, b);
  const similarity = 1 - distance / maxLength;
  if (maxLength >= 7 && distance <= 2) {
    return Math.max(similarity, 0.76);
  }
  if (maxLength >= 5 && distance <= 2 && similarity >= 0.66) {
    return similarity;
  }
  if (maxLength >= 3 && distance <= 1) {
    return similarity;
  }

  return 0;
}

function scoreTokenVariantSets(scriptVariants: string[], whisperVariants: string[]): number {
  let best = 0;
  for (const scriptVariant of scriptVariants) {
    for (const whisperVariant of whisperVariants) {
      best = Math.max(best, scoreComparableTokens(scriptVariant, whisperVariant));
    }
  }
  return best;
}

function requiredMatchScore(variants: string[]): number {
  const maxLength = variants.reduce((max, variant) => Math.max(max, variant.length), 0);
  if (maxLength <= 2) return 0.94;
  if (maxLength <= 4) return 0.72;
  return 0.6;
}

function findWhisperMatchIndex(
  cleanWhisper: Array<WhisperWord & { norms: string[] }>,
  startIndex: number,
  scriptToken: string
): number | null {
  const scriptVariants = makeComparableTokenVariants(scriptToken);
  if (scriptVariants.length === 0) {
    return null;
  }

  const threshold = requiredMatchScore(scriptVariants);
  const maxLookAhead = 8;
  let best: { index: number; score: number; adjustedScore: number } | null = null;

  for (
    let index = startIndex;
    index < Math.min(startIndex + maxLookAhead, cleanWhisper.length);
    index++
  ) {
    const score = scoreTokenVariantSets(scriptVariants, cleanWhisper[index].norms);
    if (score <= 0) {
      continue;
    }

    const adjustedScore = score - (index - startIndex) * 0.012;
    if (!best || adjustedScore > best.adjustedScore) {
      best = { index, score, adjustedScore };
    }
  }

  return best && best.score >= threshold ? best.index : null;
}

function clampTiming(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function interpolateTokenTimings(
  tokens: DisplayToken[],
  startIndex: number,
  endIndexExclusive: number,
  startTime: number,
  endTime: number
): void {
  const count = endIndexExclusive - startIndex;
  if (count <= 0) {
    return;
  }

  const weights = tokens
    .slice(startIndex, endIndexExclusive)
    .map((token) => Math.max(1, makeComparableTokenVariants(token.text)[0]?.length || token.text.length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || count;
  const boundedEnd = Math.max(startTime, endTime);
  const duration = boundedEnd - startTime;

  let cursor = startTime;
  for (let index = startIndex; index < endIndexExclusive; index++) {
    const isLast = index === endIndexExclusive - 1;
    const sliceDuration = isLast ? boundedEnd - cursor : (duration * weights[index - startIndex]) / totalWeight;
    const tokenEnd = isLast ? boundedEnd : Math.min(boundedEnd, cursor + Math.max(0, sliceDuration));
    tokens[index].startTime = cursor;
    tokens[index].endTime = Math.max(cursor, tokenEnd);
    cursor = tokens[index].endTime;
  }
}

// Given a script (original spelling) and Whisper-transcribed words (possibly
// wrong text on dialects), return tokens that keep script spelling but use
// Whisper timings. Unmatched tokens get interpolated timing between nearby
// matched anchors or segment bounds.
function matchScriptToWhisperWords(
  scriptText: string,
  whisperWords: WhisperWord[],
  segmentStartTime: number,
  segmentEndTime: number,
  segmentIndex: number,
  idOffset: number
): { tokens: DisplayToken[]; matched: number; unmatched: number } {
  const rawTokens = normalizeText(scriptText).split(' ').filter(Boolean);
  if (rawTokens.length === 0) {
    return { tokens: [], matched: 0, unmatched: 0 };
  }
  const cleanWhisper = whisperWords
    .map((w) => ({ ...w, norms: makeComparableTokenVariants(w.text) }))
    .filter((w) => w.norms.length > 0);

  const tokens: DisplayToken[] = [];
  let wIdx = 0;
  let matched = 0;
  for (let i = 0; i < rawTokens.length; i++) {
    const scriptToken = rawTokens[i];
    const scriptVariants = makeComparableTokenVariants(scriptToken);
    if (scriptVariants.length === 0) continue;

    const hitIndex = findWhisperMatchIndex(cleanWhisper, wIdx, scriptToken);
    const hit = hitIndex === null ? null : cleanWhisper[hitIndex];
    if (hit && hitIndex !== null) {
      const absoluteStart = clampTiming(segmentStartTime + hit.start, segmentStartTime, segmentEndTime);
      const absoluteEnd = clampTiming(segmentStartTime + hit.end, absoluteStart, segmentEndTime);
      tokens.push({
        id: idOffset + tokens.length,
        segmentIndex,
        text: scriptToken,
        startTime: absoluteStart,
        endTime: Math.max(absoluteStart, absoluteEnd),
      });
      wIdx = hitIndex + 1;
      matched++;
    } else {
      tokens.push({
        id: idOffset + tokens.length,
        segmentIndex,
        text: scriptToken,
        startTime: Number.NaN,
        endTime: Number.NaN,
      });
    }
  }

  let lastGood = segmentStartTime;
  for (let i = 0; i < tokens.length; i++) {
    if (Number.isFinite(tokens[i].startTime)) {
      lastGood = tokens[i].endTime;
      continue;
    }
    let nextIdx = i + 1;
    while (nextIdx < tokens.length && !Number.isFinite(tokens[nextIdx].startTime)) {
      nextIdx++;
    }
    const nextTime =
      nextIdx < tokens.length && Number.isFinite(tokens[nextIdx].startTime)
        ? tokens[nextIdx].startTime
        : segmentEndTime;
    interpolateTokenTimings(tokens, i, nextIdx, lastGood, nextTime);
    i = nextIdx - 1;
    lastGood = nextTime;
  }

  return { tokens, matched, unmatched: tokens.length - matched };
}

async function synthesizeSegmentsWithGemini(
  jobId: string,
  jobDir: string,
  segments: Segment[],
  apiKey: string,
  geminiStyle: 'plain' | 'expressive-lite',
  geminiTempo: 'normal' | 'fast',
  femaleVoice: string
): Promise<GeminiSynthesisResult> {
  const audioDir = path.join(jobDir, 'gemini-audio');
  await fs.mkdir(audioDir, { recursive: true });

  const startedAt = Date.now();
  let cumulativeOffset = 0;
  let lastModel = 'gemini-3.1-flash-tts-preview';
  const synthesizedSegments: GeminiAudioSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const result = await createGeminiDialogue({
      inputs: [
        {
          text: segment.text,
          voiceId: segment.speaker,
        },
      ],
      apiKey,
      geminiStyle,
      geminiTempo,
    });

    if (!result.ok) {
      throw new Error(result.error);
    }

    if (!result.value.audioBase64) {
      throw new Error('Gemini TTS returned no audio payload.');
    }

    lastModel = result.value.model || lastModel;
    const audioBuffer = dataUrlToBuffer(result.value.audioBase64);
    const extension = result.value.mimeType === 'audio/wav' ? 'wav' : 'bin';
    const audioFile = `segment_${String(i + 1).padStart(4, '0')}.${extension}`;
    const audioPath = path.join(audioDir, audioFile);
    await fs.writeFile(audioPath, audioBuffer);
    if (
      result.value.mimeType === 'audio/wav' &&
      shouldSpeedUpGeminiFemaleSegment(segment.speaker, femaleVoice)
    ) {
      await speedUpAudioFile(audioPath, GEMINI_FEMALE_AUDIO_TEMPO);
    }

    const durationSeconds = await probeDurationSeconds(audioPath);
    synthesizedSegments.push({
      segment_id: `segment_${String(i + 1).padStart(4, '0')}`,
      speaker: segment.speaker,
      audio_file: audioFile,
      audio_path: audioPath,
      audio_content_type: result.value.mimeType,
      duration_seconds: durationSeconds,
      start_time_seconds: cumulativeOffset,
      end_time_seconds: cumulativeOffset + durationSeconds,
    });
    cumulativeOffset += durationSeconds;

    await setPhase(
      jobId,
      'omnivoice_tts',
      `Synthesizing Gemini audio ${i + 1}/${segments.length}…`,
      {
        current: i + 1,
        total: segments.length,
      }
    );
  }

  return {
    segments: synthesizedSegments,
    elapsed_ms: Date.now() - startedAt,
    model: lastModel,
    caption_warning:
      'Gemini captions use Whisper word timing reconciliation when captions are burned; displayed text remains the cleaned script text.',
  };
}

async function synthesizeSegmentsWithElevenLabs(
  jobId: string,
  jobDir: string,
  segments: Segment[],
  apiKey: string,
  modelId?: string | null
): Promise<GeminiSynthesisResult> {
  const audioDir = path.join(jobDir, 'elevenlabs-audio');
  await fs.mkdir(audioDir, { recursive: true });

  const startedAt = Date.now();
  let cumulativeOffset = 0;
  let lastModel = modelId || 'eleven_v3';
  const synthesizedSegments: GeminiAudioSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const result = await createDialogue({
      inputs: [
        {
          text: segment.text,
          voiceId: segment.speaker,
        },
      ],
      apiKey,
      modelId: modelId || undefined,
      includeTimestamps: false,
    });

    if (!result.ok) {
      throw new Error(result.error);
    }

    lastModel = modelId || lastModel;
    const audioBuffer = dataUrlToBuffer(result.value.audioBase64);
    const audioFile = `segment_${String(i + 1).padStart(4, '0')}.mp3`;
    const audioPath = path.join(audioDir, audioFile);
    await fs.writeFile(audioPath, audioBuffer);

    const durationSeconds = await probeDurationSeconds(audioPath);
    synthesizedSegments.push({
      segment_id: `segment_${String(i + 1).padStart(4, '0')}`,
      speaker: segment.speaker,
      audio_file: audioFile,
      audio_path: audioPath,
      audio_content_type: 'audio/mpeg',
      duration_seconds: durationSeconds,
      start_time_seconds: cumulativeOffset,
      end_time_seconds: cumulativeOffset + durationSeconds,
    });
    cumulativeOffset += durationSeconds;

    await setPhase(
      jobId,
      'omnivoice_tts',
      `Synthesizing ElevenLabs audio ${i + 1}/${segments.length}…`,
      {
        current: i + 1,
        total: segments.length,
      }
    );
  }

  return {
    segments: synthesizedSegments,
    elapsed_ms: Date.now() - startedAt,
    model: lastModel,
    caption_warning:
      'ElevenLabs direct captions use estimated word timing derived from segment duration (no Whisper alignment in pipeline B).',
  };
}

async function transcribeSegmentWords(
  omnivoiceJobId: string,
  segmentFilename: string,
  language = 'pl'
): Promise<WhisperWord[]> {
  const url = `${OMNIVOICE_BASE_URL}/api/v1/podcast-film/jobs/${encodeURIComponent(
    omnivoiceJobId
  )}/transcribe-words?segment=${encodeURIComponent(segmentFilename)}&language=${encodeURIComponent(
    language
  )}`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`transcribe-words ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { words?: WhisperWord[] };
  return Array.isArray(data.words) ? data.words : [];
}

function inferAudioContentType(audioPath: string, contentType?: string | null): string {
  const normalizedContentType = String(contentType || '').trim().toLowerCase();
  if (normalizedContentType.startsWith('audio/')) {
    return normalizedContentType;
  }

  const extension = path.extname(audioPath).toLowerCase();
  if (extension === '.wav') return 'audio/wav';
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.m4a') return 'audio/mp4';
  if (extension === '.webm') return 'audio/webm';
  return 'application/octet-stream';
}

function buildWhisperUploadFilename(audioPath: string, contentType?: string | null): string {
  const parsed = path.parse(audioPath);
  if (parsed.ext && parsed.ext.toLowerCase() !== '.bin') {
    return path.basename(audioPath);
  }

  const inferredContentType = inferAudioContentType(audioPath, contentType);
  if (inferredContentType.includes('wav')) return `${parsed.name}.wav`;
  if (inferredContentType.includes('mpeg') || inferredContentType.includes('mp3')) {
    return `${parsed.name}.mp3`;
  }
  if (inferredContentType.includes('mp4') || inferredContentType.includes('m4a')) {
    return `${parsed.name}.m4a`;
  }
  if (inferredContentType.includes('webm')) return `${parsed.name}.webm`;
  return path.basename(audioPath);
}

function normalizeWhisperWords(data: unknown): WhisperWord[] {
  if (!isPlainObject(data) || !Array.isArray(data.words)) {
    return [];
  }

  const words: WhisperWord[] = [];
  for (const item of data.words) {
    if (!isPlainObject(item)) {
      continue;
    }

    const text = String(item.word || item.text || '').trim();
    const start = Number(item.start);
    const end = Number(item.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }

    const safeStart = Math.max(0, start);
    words.push({
      text,
      start: safeStart,
      end: Math.max(safeStart, end),
    });
  }

  return words;
}

async function transcribeAudioFileWords(
  audioPath: string,
  language = 'pl',
  apiKey: string,
  contentType?: string | null
): Promise<WhisperWord[]> {
  const audioBuffer = await fs.readFile(audioPath);
  const form = new UndiciFormData();
  form.append(
    'file',
    new Blob([new Uint8Array(audioBuffer)], {
      type: inferAudioContentType(audioPath, contentType),
    }),
    buildWhisperUploadFilename(audioPath, contentType)
  );
  form.append('model', process.env.OPENAI_WHISPER_MODEL || 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  if (language.trim()) {
    form.append('language', language.trim());
  }

  const res = await undiciFetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    signal: AbortSignal.timeout(OPENAI_WHISPER_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`OpenAI whisper ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  return normalizeWhisperWords(await res.json());
}

// Highlight: at each active word, show up to `visibleWords` recent words;
// paint the current word in wordColor, others in lineColor. Each visible
// word is rendered on its own ASS row so long words do not crowd one line.
function buildHighlightAss(tokens: DisplayToken[], style: CaptionStyle): string {
  const lines: string[] = [buildAssHeader(style)];
  if (tokens.length === 0) return lines.join('\n') + '\n';

  const activeHex = hexToAssColor(style.wordColor);
  const inactiveHex = hexToAssColor(style.lineColor);
  const visible = Math.max(1, style.visibleWords);

  for (let i = 0; i < tokens.length; i++) {
    const active = tokens[i];
    const startIdx = Math.max(0, i - (visible - 1));
    const renderedLines = tokens.slice(startIdx, i + 1).map((tok) => {
      const display = escapeAssText(toCaptionCase(tok.text));
      if (tok.id === active.id) {
        return `{\\c${activeHex}}${display}{\\c${inactiveHex}}`;
      }
      return display;
    });
    const text = renderedLines.join('\\N');
    if (!text) continue;

    const start = formatAssTime(active.startTime);
    const end = formatAssTime(active.endTime);
    lines.push(
      `Dialogue: 0,${start},${end},Default,,0,0,${style.marginV},,${text}`
    );
  }

  return lines.join('\n') + '\n';
}
const COVER_TEMPLATE_PATH = '/root/AiPodcast/podcast_cover.png';
const COVER_OVERLAY_Y = 420;
const COVER_OVERLAY_W = 1080;
const COVER_OVERLAY_H = 940;
const CAPTION_START_DELAY_SECONDS = 0.12;

function formatFirstFrameTitle(raw: string): string {
  const words = raw
    .replace(/\r\n?/g, '\n')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  return words.length > 0 ? words.join('\n') : raw.trim();
}

function resolveFirstFrameTitleFontSize(titleText: string, style: FirstFrameStyle): number {
  const lines = titleText.split('\n').filter((line) => line.trim());
  const lineCount = Math.max(1, lines.length);
  const longestLine = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const requestedSize = Math.round(style.titleSize * FIRST_FRAME_PREVIEW_SCALE);
  const renderMarginX = Math.round(style.titleMarginX * FIRST_FRAME_PREVIEW_SCALE);
  const availableWidth = 1080 - renderMarginX * 2 - 20;
  const availableHeight = COVER_OVERLAY_H - 48;
  let nextSize = Math.max(58, requestedSize);
  while (
    nextSize > 58 &&
    (longestLine * nextSize * 0.62 * FIRST_FRAME_TITLE_SCALE_X > availableWidth ||
      lineCount * nextSize * 1.24 > availableHeight)
  ) {
    nextSize -= 1;
  }
  return nextSize;
}

function formatImageMagickGeometryOffset(x: number, y: number): string {
  const formatPart = (value: number) => {
    const rounded = Math.round(value);
    return rounded < 0 ? String(rounded) : `+${rounded}`;
  };
  return `${formatPart(x)}${formatPart(y)}`;
}

async function generateTitleOverlayPng(
  titleText: string,
  outputPng: string,
  style: FirstFrameStyle
): Promise<void> {
  // Use ImageMagick to render each line centered with stroke — ffmpeg drawtext
  // cannot center individual lines of a multiline block in v5.1.
  const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  const FONT_SIZE = resolveFirstFrameTitleFontSize(titleText, style);
  const STROKE_WIDTH = 12;
  const SHADOW_OFFSET_X = 10;
  const SHADOW_OFFSET_Y = 10;
  const IMG_W = 1080;
  const IMG_H = 1920;
  const CENTER_Y = 890 + Math.round(style.titleOffsetY * FIRST_FRAME_PREVIEW_SCALE);
  const offset = CENTER_Y - IMG_H / 2; // relative to ImageMagick gravity Center
  const titleLayerPng = outputPng.replace(/\.png$/i, '_title.png');
  const stretchedTitleLayerPng = outputPng.replace(/\.png$/i, '_title_wide.png');
  const stretchedWidth = Math.round(IMG_W * FIRST_FRAME_TITLE_SCALE_X);
  const stretchedX = -Math.round((stretchedWidth - IMG_W) / 2);

  const runConvert = (args: string[]) =>
    new Promise<void>((resolve, reject) => {
      const proc = spawn('convert', args);
      let stderr = '';
      proc.stderr.on('data', (c) => (stderr += c.toString()));
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ImageMagick title overlay exit ${code}: ${stderr.slice(-400)}`));
      });
    });

  try {
    await runConvert([
      '-size', `${IMG_W}x${IMG_H}`,
      'xc:none',
      '-fill', 'rgba(0,0,0,0.26)',
      '-draw', `rectangle 0,${COVER_OVERLAY_Y} ${IMG_W},${COVER_OVERLAY_Y + COVER_OVERLAY_H}`,
      outputPng,
    ]);

    await runConvert([
      '-size', `${IMG_W}x${IMG_H}`,
      'xc:none',
      '-font', FONT,
      '-pointsize', String(FONT_SIZE),
      '-fill', style.titleOutlineColor,
      '-stroke', style.titleOutlineColor,
      '-strokewidth', String(STROKE_WIDTH),
      '-gravity', 'Center',
      '-annotate', formatImageMagickGeometryOffset(SHADOW_OFFSET_X, offset + SHADOW_OFFSET_Y),
      titleText,
      '-annotate', formatImageMagickGeometryOffset(0, offset),
      titleText,
      '-stroke', 'none',
      '-strokewidth', '0',
      '-fill', style.titleColor,
      '-annotate', formatImageMagickGeometryOffset(0, offset),
      titleText,
      titleLayerPng,
    ]);

    await runConvert([
      titleLayerPng,
      '-resize', `${stretchedWidth}x${IMG_H}!`,
      stretchedTitleLayerPng,
    ]);

    await runConvert([
      outputPng,
      stretchedTitleLayerPng,
      '-geometry', `${stretchedX}+0`,
      '-composite',
      outputPng,
    ]);
  } finally {
    await fs.unlink(titleLayerPng).catch(() => {});
    await fs.unlink(stretchedTitleLayerPng).catch(() => {});
  }
}

async function compositeOnCover(
  concatMp4: string,
  outputMp4: string,
  titleTextFile: string | null,
  firstFrameStyle: FirstFrameStyle
): Promise<{ elapsed_ms: number }> {
  const start = Date.now();

  // Generate title overlay PNG via ImageMagick for proper per-line centering
  let titleOverlayPng: string | null = null;
  if (titleTextFile) {
    const rawTitle = await fs.readFile(titleTextFile, 'utf8');
    titleOverlayPng = titleTextFile.replace('.txt', '_overlay.png');
    await generateTitleOverlayPng(rawTitle, titleOverlayPng, firstFrameStyle);
  }

  // Shine: periodic left→right light sweep over "Ai podcast" logo (top COVER_OVERLAY_Y px), every 15 s
  // floor-based modulo avoids fmod() which is unavailable in ffmpeg 5.1 geq expressions
  const shineSrc = `color=white:s=${COVER_OVERLAY_W}x${COVER_OVERLAY_Y}:r=30,format=rgba,geq=r=255:g=255:b=255:a=180*exp(-(((X/W-(T-floor(T/15.0)*15.0)/1.2)*(X/W-(T-floor(T/15.0)*15.0)/1.2))*40))*(1/(1+exp(1000*((T-floor(T/15.0)*15.0)-1.2))))`;

  const baseFilter = `[0:v]scale=${COVER_OVERLAY_W}:${COVER_OVERLAY_W}:flags=lanczos,crop=${COVER_OVERLAY_W}:${COVER_OVERLAY_H}:0:${(COVER_OVERLAY_W - COVER_OVERLAY_H) / 2}[fg];[1:v][fg]overlay=0:${COVER_OVERLAY_Y}[bg]`;

  let filterComplex: string;
  let ffmpegArgs: string[];

  if (titleOverlayPng) {
    // inputs: [0]=video [1]=cover [2]=titlePng [3]=shine
    filterComplex = `${baseFilter};[bg][2:v]overlay=0:0:enable='between(t,0,${CAPTION_START_DELAY_SECONDS})'[titled];[titled][3:v]overlay=0:0`;
    ffmpegArgs = [
      '-y', '-i', concatMp4, '-i', COVER_TEMPLATE_PATH, '-i', titleOverlayPng,
      '-f', 'lavfi', '-i', shineSrc,
      '-filter_complex', filterComplex,
      '-map', '0:a?', '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'medium',
      '-crf', '18', '-pix_fmt', 'yuv420p', '-shortest', outputMp4,
    ];
  } else {
    // inputs: [0]=video [1]=cover [2]=shine
    filterComplex = `${baseFilter};[bg][2:v]overlay=0:0`;
    ffmpegArgs = [
      '-y', '-i', concatMp4, '-i', COVER_TEMPLATE_PATH,
      '-f', 'lavfi', '-i', shineSrc,
      '-filter_complex', filterComplex,
      '-map', '0:a?', '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'medium',
      '-crf', '18', '-pix_fmt', 'yuv420p', '-shortest', outputMp4,
    ];
  }

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', ffmpegArgs);
    let stderr = '';
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg composite exit ${code}: ${stderr.slice(-600)}`));
    });
  });

  if (titleOverlayPng) await fs.unlink(titleOverlayPng).catch(() => {});
  return { elapsed_ms: Date.now() - start };
}

async function burnAssOntoMp4(
  jobDir: string,
  inputMp4: string,
  assFilename: string,
  outputMp4: string
): Promise<{ elapsed_ms: number }> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'ffmpeg',
      [
        '-y',
        '-i', inputMp4,
        '-vf', `ass=${assFilename}`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-c:a', 'copy',
        '-movflags', '+faststart',
        outputMp4,
      ],
      { cwd: jobDir }
    );
    let stderr = '';
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ elapsed_ms: Date.now() - startedAt });
      else reject(new Error(`ffmpeg ass burn exit ${code}: ${stderr.slice(-600)}`));
    });
  });
}

async function probeDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => (stdout += c.toString()));
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exit ${code}: ${stderr.slice(-300)}`));
      const d = parseFloat(stdout.trim());
      if (!Number.isFinite(d)) return reject(new Error(`ffprobe invalid duration: "${stdout}"`));
      resolve(d);
    });
  });
}

async function speedUpAudioFile(filePath: string, tempo: number): Promise<void> {
  if (tempo <= 1) {
    return;
  }

  const tmpPath = `${filePath}.tempo-${process.pid}-${Date.now()}.wav`;
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-i',
      filePath,
      '-filter:a',
      `atempo=${tempo.toFixed(3)}`,
      tmpPath,
    ]);
    let stderr = '';
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg atempo exit ${code}: ${stderr.slice(-600)}`));
    });
  });
  await fs.rename(tmpPath, filePath);
}

function shouldSpeedUpGeminiFemaleSegment(speaker: string, femaleVoice: string): boolean {
  const normalizedSpeaker = speaker.trim().toLowerCase();
  const normalizedFemaleVoice = femaleVoice.trim().toLowerCase();
  return normalizedSpeaker === normalizedFemaleVoice || normalizedSpeaker === 'kore';
}

async function concatSegmentsToMp4(
  segmentsDir: string,
  segmentFiles: string[],
  outputPath: string,
  options: { transition?: 'none' | 'crossfade'; transitionDuration?: number } = {}
): Promise<{ mode: 'copy' | 'reencode' | 'xfade'; elapsed_ms: number; final_duration_seconds?: number; transition_skipped_reason?: string }> {
  const transition = options.transition ?? 'crossfade';
  const transitionDuration = options.transitionDuration ?? 2;

  if (transition === 'crossfade' && segmentFiles.length >= 2) {
    const durations: number[] = [];
    for (const f of segmentFiles) {
      durations.push(await probeDurationSeconds(path.join(segmentsDir, f)));
    }
    const fadeHalf = transitionDuration / 2;
    const minDur = Math.min(...durations);
    if (minDur <= transitionDuration + 0.05) {
      const skipReason = `transition_duration ${transitionDuration}s too close to shortest segment ${minDur.toFixed(2)}s`;
      const copyResult = await concatSegmentsCopyMode(segmentsDir, segmentFiles, outputPath);
      return { ...copyResult, transition_skipped_reason: skipReason };
    }

    const N = segmentFiles.length;
    const inputArgs: string[] = [];
    for (const f of segmentFiles) {
      inputArgs.push('-i', path.join(segmentsDir, f));
    }

    // Video-only fade: fade-out last fadeHalf of clip i (except last),
    // fade-in first fadeHalf of clip i (except first). Audio passes through
    // untouched into concat. Output duration = sum(durations), unchanged.
    const vFilters: string[] = [];
    const vLabels: string[] = [];
    for (let i = 0; i < N; i++) {
      const parts: string[] = [];
      if (i > 0) parts.push(`fade=t=in:st=0:d=${fadeHalf.toFixed(6)}`);
      if (i < N - 1)
        parts.push(
          `fade=t=out:st=${(durations[i] - fadeHalf).toFixed(6)}:d=${fadeHalf.toFixed(6)}`
        );
      const label = `[v${i}]`;
      vFilters.push(`[${i}:v]${parts.join(',')}${label}`);
      vLabels.push(label);
    }

    const concatInputs: string[] = [];
    for (let i = 0; i < N; i++) {
      concatInputs.push(vLabels[i]);
      concatInputs.push(`[${i}:a]`);
    }
    const concatFilter = `${concatInputs.join('')}concat=n=${N}:v=1:a=1[vout][aout]`;
    const filterComplex = [...vFilters, concatFilter].join(';');

    const totalDuration = durations.reduce((a, b) => a + b, 0);
    const startedAt = Date.now();
    await runFfmpeg([
      '-y',
      ...inputArgs,
      '-filter_complex', filterComplex,
      '-map', '[vout]',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      outputPath,
    ]);
    return {
      mode: 'xfade',
      elapsed_ms: Date.now() - startedAt,
      final_duration_seconds: totalDuration,
    };
  }

  return concatSegmentsCopyMode(segmentsDir, segmentFiles, outputPath);
}

async function concatSegmentsCopyMode(
  segmentsDir: string,
  segmentFiles: string[],
  outputPath: string
): Promise<{ mode: 'copy' | 'reencode'; elapsed_ms: number }> {
  const listPath = path.join(segmentsDir, 'concat.txt');
  const listBody = segmentFiles
    .map((f) => `file '${f.replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fs.writeFile(listPath, listBody, 'utf8');

  const startedAt = Date.now();
  try {
    await runFfmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      outputPath,
    ]);
    return { mode: 'copy', elapsed_ms: Date.now() - startedAt };
  } catch {
    const reencodeStart = Date.now();
    await runFfmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      outputPath,
    ]);
    return { mode: 'reencode', elapsed_ms: Date.now() - reencodeStart };
  }
}

async function renderSegmentViaSoulX(args: {
  imageBuf: Buffer;
  imageName: string;
  imageType: string;
  audioBuf: Buffer;
  audioName: string;
  audioType: string;
  modelType: 'pro' | 'lite';
  useFaceCrop: boolean;
}): Promise<Buffer> {
  const fd = new FormData();
  fd.append(
    'image',
    new Blob([bufferToBlobPart(args.imageBuf)], { type: args.imageType }),
    args.imageName
  );
  fd.append(
    'audio',
    new Blob([bufferToBlobPart(args.audioBuf)], { type: args.audioType }),
    args.audioName
  );
  fd.append('model_type', args.modelType);
  fd.append('use_face_crop', args.useFaceCrop ? 'true' : 'false');
  const res = await fetch(`${SOULX_BASE_URL}/generate`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `SoulX /generate failed: ${res.status} ${text.slice(0, 300)}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

async function preparePipelineInput(config: Pick<
  PipelineConfig,
  'conversation' | 'transcript' | 'title' | 'language' | 'voice1' | 'voice2' | 'ttsEngine' | 'geminiStyle' | 'geminiTempo'
>,
  internalAppBaseUrl: string,
  onProgress?: (message: string, current: number, total: number) => Promise<void> | void
): Promise<PreparedPipelineInput> {
  const reportProgress = async (message: string, current: number, total: number) => {
    await onProgress?.(message, current, total);
  };

  let voiceRegistry: Map<string, VoiceEntry>;
  let voice1 = config.voice1;
  let voice2 = config.voice2;
  let maleVoice = config.voice1;
  let femaleVoice = config.voice2;
  let voicesSwapped = false;
  const progressTotal = 4;

  await reportProgress('Resolving voice registry…', 1, progressTotal);

  if (config.ttsEngine === 'gemini') {
    const omnivoiceRegistry = await fetchVoiceRegistryOptional();
    const resolvedGeminiVoices = resolveGeminiVoiceSelection(
      config.voice1,
      config.voice2,
      omnivoiceRegistry
    );
    voiceRegistry = resolvedGeminiVoices.voiceRegistry;
    voice1 = resolvedGeminiVoices.voice1;
    voice2 = resolvedGeminiVoices.voice2;
    maleVoice = resolvedGeminiVoices.maleVoice;
    femaleVoice = resolvedGeminiVoices.femaleVoice;
    voicesSwapped = resolvedGeminiVoices.voicesSwapped;
  } else if (config.ttsEngine === 'elevenlabs') {
    const omnivoiceRegistry = await fetchVoiceRegistryOptional();
    voiceRegistry = buildDirectAvatarVoiceRegistry({
      voice1: config.voice1,
      voice2: config.voice2,
      omnivoiceRegistry,
    });
    maleVoice = config.voice1;
    femaleVoice = config.voice2;
  } else {
    try {
      voiceRegistry = await fetchVoiceRegistry();
    } catch (error) {
      throw new PipelineInputError(502, {
        error: 'Failed to fetch OmniVoice voice registry.',
        detail: describeError(error),
      });
    }

    const genderedPair = resolveGenderedVoicePair(config.voice1, config.voice2, voiceRegistry);
    maleVoice = genderedPair.maleVoice;
    femaleVoice = genderedPair.femaleVoice;
    voicesSwapped = genderedPair.swapped;
  }

  await reportProgress('Preparing dialogue segments…', 2, progressTotal);

  let segments: Segment[] | null = segmentsFromConversation(
    config.conversation,
    voice1,
    voice2
  );

  if (!segments && config.transcript) {
    segments = parseTranscriptToSegments(config.transcript, voice1, voice2);
  }

  if ((!segments || segments.length === 0) && config.transcript) {
    await reportProgress('Generating conversation draft…', 3, progressTotal);
    try {
      segments = await generateSegmentsFromRawText(
        config.transcript,
        config.title || 'Podcast Video',
        config.language,
        maleVoice,
        femaleVoice,
        config.ttsEngine,
        config.geminiStyle,
        config.geminiTempo,
        internalAppBaseUrl
      );
    } catch (error) {
      throw new PipelineInputError(502, {
        error: 'Failed to generate podcast conversation from raw text.',
        detail: describeError(error),
      });
    }
  }

  await reportProgress('Finalizing dialogue segments…', 4, progressTotal);

  if (!segments || segments.length === 0) {
    throw new PipelineInputError(400, {
      error:
        'No segments produced from conversation[], speaker-marked transcript, or raw-text generation.',
    });
  }

  const allowedInlineTags =
    config.ttsEngine === 'gemini' && config.geminiStyle === 'expressive-lite'
      ? GEMINI_EXPRESSIVE_ALLOWED_INLINE_TAGS
      : undefined;

  segments = segments
    .map((segment) => ({ ...segment, text: stripTtsInlineTags(segment.text, allowedInlineTags) }))
    .filter((segment) => segment.text.length > 0);

  if (segments.length === 0) {
    throw new PipelineInputError(400, {
      error: 'All segments were empty after TTS sanitization.',
    });
  }

  return {
    segments,
    voiceRegistry,
    voice1,
    voice2,
    maleVoice,
    femaleVoice,
    voicesSwapped,
  };
}

async function runBackgroundPipeline(
  jobId: string,
  config: PipelineConfig,
  publicBaseUrl: string,
  internalAppBaseUrl: string
): Promise<void> {
  const paths = await ensurePodcastVideoArchiveDir(jobId);
  await fs.mkdir(paths.segmentsDir, { recursive: true });
  const workerUrl = `${OMNIVOICE_BASE_URL}/api/v1/podcast-film/jobs`;

  await setPhase(jobId, 'generate_podcast', 'Preparing dialogue and voices…', {
    current: 0,
    total: 4,
  });
  const prepared = await preparePipelineInput(
    config,
    internalAppBaseUrl,
    async (message, current, total) => {
      await setPhase(jobId, 'generate_podcast', message, { current, total });
    }
  );
  const {
    segments,
    voiceRegistry,
    voice1: resolvedVoice1,
    voice2: resolvedVoice2,
    maleVoice,
    femaleVoice,
    voicesSwapped,
  } = prepared;

  await setPhase(jobId, 'fetch_voices_images', 'Loading avatar images…', {
    current: 0,
    total: 2,
  });
  const [womanFiles, menFiles] = await Promise.all([
    fetchImageList('Woman'),
    fetchImageList('Men'),
  ]);
  await setPhase(jobId, 'fetch_voices_images', 'Loading avatar images…', {
    current: 2,
    total: 2,
  });
  const snapshots = new Map<string, string[]>([
    ['Woman', womanFiles],
    ['Men', menFiles],
  ]);
  const cursors = new Map<string, number>();
  if (config.imageRotationSeed !== null && Number.isFinite(config.imageRotationSeed)) {
    const base = Math.max(0, Math.floor(config.imageRotationSeed));
    cursors.set('Woman', womanFiles.length ? base % womanFiles.length : 0);
    cursors.set('Men', menFiles.length ? base % menFiles.length : 0);
  }

  await setPhase(
    jobId,
    'omnivoice_tts',
    config.ttsEngine === 'omnivoice'
      ? 'Synthesizing voice audio…'
      : `Synthesizing ${config.ttsEngine === 'gemini' ? 'Gemini' : 'ElevenLabs'} audio 0/${segments.length}…`,
    config.ttsEngine === 'omnivoice'
      ? null
      : {
          current: 0,
          total: segments.length,
        }
  );

  let workerData:
    | {
        job_id: string;
        manifest: {
          segments: Array<{
            segment_id: string;
            speaker: string;
            audio_file: string;
            duration_seconds: number;
            start_time_seconds: number;
            end_time_seconds: number;
          }>;
        };
      }
    | null = null;
  let workerElapsedMs: number | undefined;
  let directData: GeminiSynthesisResult | null = null;

  if (config.ttsEngine === 'gemini') {
    const geminiApiKey = resolvePodcastFilmGeminiApiKey(config.geminiApiKey);
    if (!geminiApiKey) {
      throw new PipelineInputError(403, {
        error: 'Gemini API key is not configured for podcast-film.',
      });
    }
    directData = await synthesizeSegmentsWithGemini(
      jobId,
      paths.dir,
      segments,
      geminiApiKey,
      config.geminiStyle,
      config.geminiTempo,
      femaleVoice
    );
  } else if (config.ttsEngine === 'elevenlabs') {
    const elevenlabsApiKey = resolvePodcastFilmElevenLabsApiKey(config.elevenlabsApiKey);
    if (!elevenlabsApiKey) {
      throw new PipelineInputError(403, {
        error: 'ElevenLabs API key is not configured for podcast-film.',
      });
    }
    directData = await synthesizeSegmentsWithElevenLabs(
      jobId,
      paths.dir,
      segments,
      elevenlabsApiKey,
      config.ttsModel
    );
  } else {
    const workerStartedAt = Date.now();
    let workerRes;
    try {
      workerRes = await undiciFetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ script_segments: segments }),
        signal: AbortSignal.timeout(OMNIVOICE_JOB_TIMEOUT_MS),
        dispatcher: OMNIVOICE_JOB_DISPATCHER,
      });
    } catch (error) {
      throw new Error(`Failed to reach OmniVoice worker (${workerUrl}): ${describeError(error)}`);
    }
    if (!workerRes.ok) {
      const txt = await workerRes.text();
      throw new Error(`OmniVoice worker returned ${workerRes.status}: ${txt.slice(0, 500)}`);
    }
    workerData = (await workerRes.json()) as {
      job_id: string;
      manifest: {
        segments: Array<{
          segment_id: string;
          speaker: string;
          audio_file: string;
          duration_seconds: number;
          start_time_seconds: number;
          end_time_seconds: number;
        }>;
      };
    };
    workerElapsedMs = Date.now() - workerStartedAt;
  }

  const manifestSegments =
    config.ttsEngine === 'omnivoice'
      ? workerData!.manifest.segments
      : directData!.segments;

  const totalSegs = manifestSegments.length;
  await setPhase(jobId, 'soulx_talkhead', `Rendering avatar 0/${totalSegs}…`, {
    current: 0,
    total: totalSegs,
  });
  const segmentResults: Array<{
    segment_id: string;
    voice_id: string;
    image_folder: string;
    image_file: string;
    mp4_file: string;
    mp4_url: string;
    duration_seconds: number;
    actual_duration_seconds: number;
    text: string;
    soulx_elapsed_ms: number;
  }> = [];
  const renderStartedAt = Date.now();
  for (let i = 0; i < totalSegs; i++) {
    const seg = manifestSegments[i];
    const voice = voiceRegistry.get(seg.speaker.toLowerCase());
    if (!voice) {
      throw new Error(
        `Voice "${seg.speaker}" from ${config.ttsEngine} synthesis not found in registry`
      );
    }
    const { folder, file } = pickImage(voice, cursors, snapshots, config.pinnedImages);
    const imageUrl = `${OMNIVOICE_BASE_URL}/images/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;
    const img = await fetchBytes(imageUrl);
    const aud =
      config.ttsEngine !== 'omnivoice'
        ? {
            buffer: await fs.readFile((seg as GeminiAudioSegment).audio_path),
            contentType: (seg as GeminiAudioSegment).audio_content_type,
          }
        : await fetchBytes(
            `${OMNIVOICE_BASE_URL}/api/v1/podcast-film/jobs/${encodeURIComponent(workerData!.job_id)}/file?type=segment&name=${encodeURIComponent(seg.audio_file)}`
          );
    const soulxStart = Date.now();
    const mp4Buf = await renderSegmentViaSoulX({
      imageBuf: img.buffer,
      imageName: file,
      imageType: img.contentType,
      audioBuf: aud.buffer,
      audioName: seg.audio_file,
      audioType: aud.contentType,
      modelType: config.soulxModel,
      useFaceCrop: config.useFaceCrop,
    });
    const soulxElapsed = Date.now() - soulxStart;
    const mp4Name = `segment_${String(i + 1).padStart(4, '0')}.mp4`;
    const mp4Path = path.join(paths.segmentsDir, mp4Name);
    await fs.writeFile(mp4Path, mp4Buf);
    const actualDuration = await probeDurationSeconds(mp4Path);
    segmentResults.push({
      segment_id: seg.segment_id,
      voice_id: seg.speaker,
      image_folder: folder,
      image_file: file,
      mp4_file: mp4Name,
      mp4_url: buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'segment', mp4Name),
      duration_seconds: seg.duration_seconds,
      actual_duration_seconds: actualDuration,
      text: stripCaptionInlineTags(segments[i].text),
      soulx_elapsed_ms: soulxElapsed,
    });
    await setPhase(jobId, 'soulx_talkhead', `Rendering avatar ${i + 1}/${totalSegs}…`, {
      current: i + 1,
      total: totalSegs,
    });
  }
  const renderElapsedMs = Date.now() - renderStartedAt;

  await setPhase(jobId, 'concat', 'Combining segments and overlaying cover…');
  const finalMp4Path = getPodcastVideoJobPaths(jobId).mp4;
  const concatMp4Path = path.join(paths.dir, 'concat_512.mp4');
  const concatResult = await concatSegmentsToMp4(
    paths.segmentsDir,
    segmentResults.map((segment) => segment.mp4_file),
    concatMp4Path,
    { transition: config.transition, transitionDuration: config.transitionDuration }
  );
  const finalMp4Url = buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'mp4');
  const compositeStart = Date.now();
  const compositeMp4Path = path.join(paths.dir, 'composite_1080.mp4');
  let titleTextFile: string | null = null;
  if (config.title) {
    titleTextFile = path.join(paths.dir, 'title.txt');
    await fs.writeFile(titleTextFile, formatFirstFrameTitle(config.title.toUpperCase()), 'utf8');
  }
  await compositeOnCover(concatMp4Path, compositeMp4Path, titleTextFile, config.firstFrameStyle);
  const compositeElapsedMs = Date.now() - compositeStart;
  await fs.rename(compositeMp4Path, finalMp4Path);

  const directClassicAlignmentMode = resolveDirectClassicAlignmentMode(config.ttsEngine);
  const useWhisperReconciliation =
    config.ttsEngine === 'omnivoice' || config.ttsEngine === 'gemini';
  const useDirectClassicBaseline =
    !useWhisperReconciliation &&
    config.captionStyle === 'classic' &&
    directClassicAlignmentMode === 'segment_cues';
  const segmentCaptionTimings = buildSegmentCaptionTimings(
    segmentResults.map((segment) => ({
      text: segment.text,
      duration_seconds: segment.actual_duration_seconds,
    })),
    CAPTION_START_DELAY_SECONDS
  );

  let captionsElapsedMs: number | undefined;
  const captionWarnings: string[] = [];
  if (config.ttsEngine !== 'omnivoice' && directData?.caption_warning) {
    captionWarnings.push(directData.caption_warning);
  }
  let matchedTotal = 0;
  let unmatchedTotal = 0;
  const globalTokens: DisplayToken[] = [];
  const captionAlignmentMode =
    config.captionsMode !== 'burn' || config.captionStyle === 'off'
      ? 'disabled'
      : useWhisperReconciliation
        ? 'whisper_reconciled'
        : config.captionStyle === 'classic'
          ? directClassicAlignmentMode
          : 'word_estimated';
  if (config.captionsMode === 'burn' && config.captionStyle !== 'off') {
    const alignmentPhaseLabel =
      useWhisperReconciliation
        ? 'Aligning word timing'
        : config.captionStyle === 'classic'
          ? useDirectClassicBaseline
            ? 'Building segment cue timing'
            : 'Estimating pseudo-token timing'
          : 'Estimating word timing';
    const whisperApiKey =
      config.ttsEngine === 'gemini' ? resolvePodcastFilmWhisperApiKey() : null;
    if (config.ttsEngine === 'gemini' && !whisperApiKey) {
      captionWarnings.push(
        'OpenAI Whisper API key is missing; Gemini caption timings will be interpolated from segment duration.'
      );
    }
    await setPhase(
      jobId,
      'whisper_align',
      `${alignmentPhaseLabel} 0/${segmentResults.length}…`,
      {
        current: 0,
        total: segmentResults.length,
      }
    );
    let cumulativeOffset = 0;
    let idCursor = 0;
    for (let i = 0; i < segmentResults.length; i++) {
      const segment = segmentResults[i];
      const segDuration = segment.actual_duration_seconds;
      const segStart = cumulativeOffset;
      const segEnd = cumulativeOffset + segDuration;

      if (useWhisperReconciliation) {
        let whisperWords: WhisperWord[] = [];
        if (config.ttsEngine === 'omnivoice') {
          const manifestSeg = workerData!.manifest.segments[i];
          try {
            whisperWords = await transcribeSegmentWords(
              workerData!.job_id,
              manifestSeg.audio_file,
              config.captionLanguage
            );
          } catch (error) {
            captionWarnings.push(
              `transcribe-words failed for ${manifestSeg.audio_file}: ${describeError(error).slice(0, 160)}`
            );
          }
        } else if (config.ttsEngine === 'gemini' && whisperApiKey) {
          const manifestSeg = manifestSegments[i] as GeminiAudioSegment;
          try {
            whisperWords = await transcribeAudioFileWords(
              manifestSeg.audio_path,
              config.captionLanguage,
              whisperApiKey,
              manifestSeg.audio_content_type
            );
          } catch (error) {
            captionWarnings.push(
              `OpenAI whisper failed for ${manifestSeg.audio_file}: ${describeError(error).slice(0, 160)}`
            );
          }
        }

        const { tokens, matched, unmatched } = matchScriptToWhisperWords(
          segment.text,
          whisperWords,
          segStart,
          segEnd,
          i,
          idCursor
        );
        matchedTotal += matched;
        unmatchedTotal += unmatched;
        idCursor += tokens.length;
        globalTokens.push(...tokens);
      } else if (config.ttsEngine !== 'omnivoice') {
        if (!useDirectClassicBaseline) {
          const tokens = estimateSegmentWordTimings(
            segment.text,
            segStart,
            segEnd,
            i,
            idCursor
          );
          matchedTotal += tokens.length;
          idCursor += tokens.length;
          globalTokens.push(...tokens);
        }
      }

      cumulativeOffset = segEnd;
      await setPhase(
        jobId,
        'whisper_align',
        `${alignmentPhaseLabel} ${i + 1}/${segmentResults.length}…`,
        {
          current: i + 1,
          total: segmentResults.length,
        }
      );
    }
    for (const tok of globalTokens) {
      tok.startTime += CAPTION_START_DELAY_SECONDS;
      tok.endTime += CAPTION_START_DELAY_SECONDS;
    }
    const style: CaptionStyle = {
      fontSize: config.captionFontSize,
      lineColor: config.captionLineColor,
      wordColor: config.captionWordColor,
      outlineColor: config.captionOutlineColor,
      marginV: config.captionMarginV,
      marginX: 40,
      playResX: 1080,
      playResY: 1920,
      fontName: 'DejaVu Sans',
      visibleWords: 1,
    };
    const classicCueGroups =
      config.captionStyle === 'classic'
        ? useDirectClassicBaseline
          ? buildClassicCueGroupsFromTimedSegments(segmentCaptionTimings, style.fontSize)
          : buildClassicCueGroupsFromDisplayTokens(globalTokens, style.fontSize)
        : [];
    const assContent =
      config.captionStyle === 'highlight'
        ? buildHighlightAss(globalTokens, style)
        : buildClassicAssFromCueGroups(classicCueGroups, style);
    const assPath = path.join(paths.dir, 'captions.ass');
    await fs.writeFile(assPath, assContent, 'utf8');
    const hasRenderableCaptions =
      config.captionStyle === 'highlight' ? globalTokens.length > 0 : classicCueGroups.length > 0;
    if (hasRenderableCaptions) {
      await setPhase(jobId, 'burn_subs', 'Burning captions into video…');
      const tmpMp4 = path.join(paths.dir, 'final_captioned.mp4');
      const result = await burnAssOntoMp4(paths.dir, finalMp4Path, 'captions.ass', tmpMp4);
      captionsElapsedMs = result.elapsed_ms;
      await fs.rename(tmpMp4, finalMp4Path);
    } else {
      captionWarnings.push('no caption cues produced — skipping burn');
    }
  }

  const srtCueGroups =
    captionAlignmentMode === 'whisper_reconciled' && globalTokens.length > 0
      ? buildClassicCueGroupsFromDisplayTokens(globalTokens, config.captionFontSize)
      : config.ttsEngine !== 'omnivoice' && config.captionStyle === 'classic'
      ? directClassicAlignmentMode === 'classic_pseudo_token'
        ? globalTokens.length > 0
          ? buildClassicCueGroupsFromDisplayTokens(globalTokens, config.captionFontSize)
          : buildClassicPseudoCueGroupsFromTimedSegments(
              segmentCaptionTimings,
              config.captionFontSize
            ).cues
        : buildClassicCueGroupsFromTimedSegments(segmentCaptionTimings, config.captionFontSize)
      : buildClassicCueGroupsFromTimedSegments(segmentCaptionTimings, 47);
  const srtBody = buildSrtFromCueGroups(srtCueGroups);
  const srtPath = getPodcastVideoJobPaths(jobId).srt;
  await fs.writeFile(srtPath, srtBody, 'utf8');
  const srtUrl = buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'srt');
  const captionTimingMode =
    captionAlignmentMode === 'whisper_reconciled'
      ? 'whisper'
      : captionAlignmentMode === 'disabled'
        ? 'disabled'
        : 'estimated';

  const ttsTimingMs =
    config.ttsEngine === 'omnivoice'
      ? workerElapsedMs
      : directData!.elapsed_ms;
  const metadataWrite = await writeSafeMp4GenerationMetadata(finalMp4Path, {
    title: config.title || `Podcast film ${jobId}`,
    comment: [
      'ai_pipeline=podcast-film-v1',
      `job_id=${jobId}`,
      `tts_engine=${config.ttsEngine}`,
      `soulx_model=${config.soulxModel}`,
      `voice1=${resolvedVoice1}`,
      `voice2=${resolvedVoice2}`,
      `captions=${config.captionsMode}`,
      `caption_style=${config.captionStyle}`,
    ].join(';'),
    ai_pipeline: 'podcast-film-v1',
    ai_job_id: jobId,
    ai_language: config.language,
    ai_tts_engine: config.ttsEngine,
    ai_tts_model: directData?.model,
    ai_soulx_model: config.soulxModel,
    ai_use_face_crop: config.useFaceCrop,
    ai_requested_voice1: config.voice1,
    ai_requested_voice2: config.voice2,
    ai_voice1: resolvedVoice1,
    ai_voice2: resolvedVoice2,
    ai_male_voice: maleVoice,
    ai_female_voice: femaleVoice,
    ai_voices_swapped_for_gender: voicesSwapped,
    ai_segments_count: segmentResults.length,
    ai_captions: config.captionsMode,
    ai_caption_style: config.captionStyle,
    ai_caption_timing_mode: captionTimingMode,
    ai_caption_alignment_mode: captionAlignmentMode,
    ai_transition: config.transition,
    ai_transition_duration: config.transitionDuration,
  });

  await markDone(jobId, {
    success: true,
    pipeline: 'podcast-film-v1',
    tts_engine: config.ttsEngine,
    direct_tts_model: directData?.model,
    gemini_model: config.ttsEngine === 'gemini' ? directData?.model : undefined,
    soulx_model: config.soulxModel,
    use_face_crop: config.useFaceCrop,
    image_rotation_seed: config.imageRotationSeed,
    job_id: jobId,
    omnivoice_job_id: workerData?.job_id ?? null,
    requested_voice1: config.voice1,
    requested_voice2: config.voice2,
    voice1: resolvedVoice1,
    voice2: resolvedVoice2,
    male_voice: maleVoice,
    female_voice: femaleVoice,
    voices_swapped_for_gender: voicesSwapped,
    segments_count: segmentResults.length,
    segments: segmentResults,
    mp4_url: finalMp4Url,
    srt_url: srtUrl,
    captions: config.captionsMode,
    caption_style: config.captionStyle,
    caption_font_size: config.captionFontSize,
    caption_margin_v: config.captionMarginV,
    caption_word_color: config.captionWordColor,
    caption_line_color: config.captionLineColor,
    caption_timing_mode: captionTimingMode,
    caption_alignment_mode: captionAlignmentMode,
    caption_warnings: captionWarnings,
    caption_matched_words: matchedTotal,
    caption_unmatched_words: unmatchedTotal,
    transition: config.transition,
    transition_duration: config.transitionDuration,
    transition_skipped_reason: concatResult.transition_skipped_reason,
    final_duration_seconds: concatResult.final_duration_seconds,
    timings: {
      tts_ms: ttsTimingMs,
      omnivoice_ms: config.ttsEngine === 'omnivoice' ? workerElapsedMs : undefined,
      gemini_ms: config.ttsEngine === 'gemini' ? directData!.elapsed_ms : undefined,
      elevenlabs_ms: config.ttsEngine === 'elevenlabs' ? directData!.elapsed_ms : undefined,
      soulx_total_ms: renderElapsedMs,
      concat_ms: concatResult.elapsed_ms,
      concat_mode: concatResult.mode,
      composite_ms: compositeElapsedMs,
      captions_ms: captionsElapsedMs,
      metadata_ms: metadataWrite.elapsed_ms,
    },
    mp4_metadata: {
      embedded: true,
      metadata_count: metadataWrite.metadata_count,
      safe_fields_only: true,
    },
    worker: {
      omnivoice_url: config.ttsEngine === 'omnivoice' ? workerUrl : null,
      soulx_url: `${SOULX_BASE_URL}/generate`,
    },
    note:
      config.ttsEngine === 'gemini'
        ? `v1-gemini: per-segment Gemini WAV + SoulX render + ${captionAlignmentMode === 'whisper_reconciled' ? 'Whisper timing reconciled onto cleaned original segment text.' : captionAlignmentMode === 'classic_pseudo_token' ? 'classic pseudo-token cue alignment from original segment text.' : captionAlignmentMode === 'segment_cues' ? 'baseline segment cue timing for classic captions.' : 'estimated caption timing from segment duration.'}`
        : config.ttsEngine === 'elevenlabs'
          ? `v1-elevenlabs: per-segment ElevenLabs MP3 + SoulX render + ${captionAlignmentMode === 'classic_pseudo_token' ? 'classic pseudo-token cue alignment from original segment text.' : captionAlignmentMode === 'segment_cues' ? 'baseline segment cue timing for classic captions.' : 'estimated caption timing from segment duration.'}`
          : 'v1: per-segment MP4 + concat + word-level ASS captions burned via Whisper timing reconciliation.',
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!isPodcastVideoAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as RawBody;
    if (!isPlainObject(body)) {
      return NextResponse.json(
        { error: 'Request body must be a JSON object.' },
        { status: 400 }
      );
    }

    const ttsBody = isPlainObject(body.tts) ? body.tts : {};
    const avatarBody = isPlainObject(body.avatar) ? body.avatar : {};
    const reviewBody = isPlainObject(body.review) ? body.review : {};
    const ttsEngine = normalizeTtsProvider(
      ttsBody.provider || body.tts_engine || body.ttsProvider || body.provider || 'omnivoice',
      'omnivoice'
    ) as TtsEngine;
    const avatarProvider = normalizeAvatarProvider(avatarBody.provider || 'soulx');
    const reviewMode = normalizeReviewMode(reviewBody.mode || body.review_mode || body.reviewMode);
    const transcript = String(body.raw_text || body.transcript || body.script_text || '').trim();
    const normalizedConversation = normalizeConversationItems(body.conversation);
    if (normalizedConversation.length > 0 && transcript) {
      return NextResponse.json(
        {
          error: 'Provide exactly one public input: raw_text or conversation.',
        },
        { status: 400 }
      );
    }
    const language = String(body.language || body.caption_language || 'pl').trim() || 'pl';
    const defaultVoice1 =
      ttsEngine === 'gemini'
        ? DEFAULT_GEMINI_VOICES.voice1
        : ttsEngine === 'elevenlabs'
          ? DEFAULT_ELEVENLABS_VOICES.voice1
          : 'host_a';
    const defaultVoice2 =
      ttsEngine === 'gemini'
        ? DEFAULT_GEMINI_VOICES.voice2
        : ttsEngine === 'elevenlabs'
          ? DEFAULT_ELEVENLABS_VOICES.voice2
          : 'host_b';
    const voice1 = String(ttsBody.voice1 || body.voice1 || defaultVoice1);
    const voice2 = String(ttsBody.voice2 || body.voice2 || defaultVoice2);
    const geminiStyle = normalizeGeminiStyle(ttsBody.geminiStyle || body.geminiStyle);
    const geminiTempo = normalizeGeminiTempo(ttsBody.geminiTempo || body.geminiTempo);
    const geminiApiKey =
      typeof (ttsBody.apiKey || body.gemini_api_key) === 'string'
        ? String(ttsBody.apiKey || body.gemini_api_key).trim()
        : '';
    const elevenlabsApiKey =
      typeof body.elevenlabs_api_key === 'string'
        ? body.elevenlabs_api_key.trim()
        : typeof ttsBody.apiKey === 'string' && ttsEngine === 'elevenlabs'
          ? String(ttsBody.apiKey).trim()
          : '';
    const ttsModel =
      typeof ttsBody.model === 'string'
        ? String(ttsBody.model).trim()
        : typeof body.modelId === 'string'
          ? body.modelId.trim()
          : '';
    const dryRun = Boolean(body.dry_run ?? body.dryRun ?? false);
    const soulxModelRaw = String(body.soulx_model || 'pro').toLowerCase();
    const soulxModel: 'pro' | 'lite' = soulxModelRaw === 'lite' ? 'lite' : 'pro';
    const useFaceCrop = body.use_face_crop === undefined ? true : Boolean(body.use_face_crop);
    const imageRotationSeedRaw = body.image_rotation_seed;
    const imageRotationSeed =
      imageRotationSeedRaw === undefined || imageRotationSeedRaw === null
        ? null
        : Number(imageRotationSeedRaw);
    const pinnedImages: Record<string, string> = isPlainObject(body.pinned_images)
      ? (body.pinned_images as Record<string, string>)
      : {};
    const transitionRaw = String(body.transition ?? 'none').toLowerCase();
    const transition: 'none' | 'crossfade' =
      transitionRaw === 'crossfade' ? 'crossfade' : 'none';
    const transitionDurationRaw = Number(body.transition_duration ?? 1);
    const transitionDuration =
      Number.isFinite(transitionDurationRaw) && transitionDurationRaw > 0
        ? transitionDurationRaw
        : 1;
    const captionsRaw = String(body.captions ?? 'burn').toLowerCase();
    const captionsMode: 'off' | 'burn' = captionsRaw === 'off' ? 'off' : 'burn';
    const captionStyleRaw = String(body.caption_style ?? 'highlight').toLowerCase();
    const captionStyle: 'highlight' | 'classic' | 'off' =
      captionStyleRaw === 'off'
        ? 'off'
        : captionStyleRaw === 'classic'
          ? 'classic'
          : 'highlight';
    const captionFontSize = Number.isFinite(Number(body.caption_font_size))
      ? Number(body.caption_font_size)
      : 76;
    const captionWordColor = String(body.caption_word_color ?? '#00FF04');
    const captionLineColor = String(body.caption_line_color ?? '#FFFFFF');
    const captionOutlineColor = String(body.caption_outline_color ?? '#000000');
    const captionMarginV = Number.isFinite(Number(body.caption_margin_v))
      ? Number(body.caption_margin_v)
      : 1390;
    const captionLanguage = String(body.caption_language ?? 'pl');
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const firstFrameStyle = resolveFirstFrameStyle(body.cover_style ?? body.coverStyle);

    if (normalizedConversation.length === 0 && !transcript) {
      return NextResponse.json(
        {
          error: 'Provide exactly one public input: raw_text or conversation.',
        },
        { status: 400 }
      );
    }

    if (avatarProvider !== 'soulx') {
      return NextResponse.json(
        {
          error: `avatar.provider "${avatarProvider}" is not supported yet. Use "soulx".`,
        },
        { status: 501 }
      );
    }

    await ensureRunningJobRecovery();

    const publicBaseUrl = resolvePublicBaseUrl(request);
    const internalAppBaseUrl = resolveRequestBaseUrl(request);

    if (reviewMode === 'pause_after_conversation' && transcript && !dryRun) {
      const conversationDraft = await generateConversationDraft({
        rawText: transcript,
        title: title || 'Podcast Film',
        language,
        ttsProvider: ttsEngine,
        geminiStyle,
        geminiTempo,
        internalAppBaseUrl,
        timeoutMs: INTERNAL_GENERATE_PODCAST_TIMEOUT_MS,
        llmAttemptTimeoutMs: INTERNAL_GENERATE_PODCAST_ATTEMPT_TIMEOUT_MS,
      });

      return NextResponse.json(
        {
          success: true,
          pipeline: 'podcast-film-v1',
          review_required: true,
          review_mode: reviewMode,
          input_mode: 'raw_text',
          title,
          language,
          tts_engine: ttsEngine,
          avatar_provider: avatarProvider,
          conversation: conversationDraft,
          next_step: {
            method: 'POST',
            url: `${publicBaseUrl}/api/podcast-video/podcast-film/jobs`,
            body: {
              title,
              language,
              conversation: conversationDraft,
              tts: buildClientTtsConfig({
                provider: ttsEngine,
                voice1,
                voice2,
                model: ttsModel || undefined,
                geminiStyle,
                geminiTempo,
              }),
              avatar: {
                provider: avatarProvider,
              },
              review: {
                mode: 'off',
              },
              soulx_model: soulxModel,
              use_face_crop: useFaceCrop,
              captions: captionsMode,
              caption_style: captionStyle,
              cover_style: firstFrameStyle,
            },
          },
        },
        { status: 200 }
      );
    }

    const config: PipelineConfig = {
      conversation: normalizedConversation.length > 0 ? normalizedConversation : body.conversation,
      transcript,
      language,
      voice1,
      voice2,
      ttsEngine,
      geminiApiKey: geminiApiKey || null,
      geminiStyle,
      geminiTempo,
      elevenlabsApiKey: elevenlabsApiKey || null,
      ttsModel: ttsModel || null,
      soulxModel,
      avatarProvider,
      reviewMode,
      useFaceCrop,
      imageRotationSeed,
      pinnedImages,
      transition,
      transitionDuration,
      captionsMode,
      captionStyle,
      captionFontSize,
      captionWordColor,
      captionLineColor,
      captionOutlineColor,
      captionMarginV,
      captionLanguage,
      title,
      firstFrameStyle,
    };

    if (ttsEngine === 'gemini' && !dryRun && !resolvePodcastFilmGeminiApiKey(geminiApiKey)) {
      return NextResponse.json(
        {
          error: 'Gemini API key is not configured for podcast-film.',
          code: 'MISSING_GEMINI_KEY',
        },
        { status: 403 }
      );
    }

    if (
      ttsEngine === 'elevenlabs' &&
      !dryRun &&
      !resolvePodcastFilmElevenLabsApiKey(elevenlabsApiKey)
    ) {
      return NextResponse.json(
        {
          error: 'ElevenLabs API key is not configured for podcast-film.',
          code: 'MISSING_ELEVENLABS_KEY',
        },
        { status: 403 }
      );
    }

    if (dryRun) {
      try {
        const prepared = await preparePipelineInput(config, internalAppBaseUrl);
        return NextResponse.json({
          success: true,
          pipeline: 'podcast-film-v1',
          tts_engine: ttsEngine,
          avatar_provider: avatarProvider,
          review_mode: reviewMode,
          dry_run: true,
          segments_count: prepared.segments.length,
          soulx_model: soulxModel,
          use_face_crop: useFaceCrop,
          requested_voice1: voice1,
          requested_voice2: voice2,
          voice1: prepared.voice1,
          voice2: prepared.voice2,
          male_voice: prepared.maleVoice,
          female_voice: prepared.femaleVoice,
          voices_swapped_for_gender: prepared.voicesSwapped,
          first_frame_style: firstFrameStyle,
          segments_preview: prepared.segments.map((segment) => ({
            voice_id: segment.speaker,
            text: segment.text,
          })),
        });
      } catch (error) {
        if (error instanceof PipelineInputError) {
          return NextResponse.json(error.body, { status: error.status });
        }
        return NextResponse.json(
          {
            error: 'Pipeline B dry-run failed.',
            detail: describeError(error),
          },
          { status: 500 }
        );
      }
    }

    const infrastructureLease = acquirePodcastFilmDockerLease();
    const dockerStart = await ensurePodcastFilmDockerContainersStarted();
    if (dockerStart.enabled) {
      console.info(`[podcast-film] Docker start result: ${dockerStart.detail}`);
    }

    const workerChecks =
      dockerStart.enabled && dockerStart.dockerAvailable
        ? await waitForWorkerPreflightChecks(ttsEngine)
        : await runWorkerPreflightChecks(ttsEngine);
    const failedWorkerChecks = workerChecks.filter((check) => !check.ok);
    if (failedWorkerChecks.length > 0) {
      infrastructureLease.release();
      const detail = summarizeFailedWorkerChecks(workerChecks);
      return NextResponse.json(
        {
          error: 'Podcast-film worker preflight failed.',
          detail,
          checks: workerChecks,
          docker_lifecycle: dockerStart,
        },
        { status: 503 }
      );
    }

    const jobId = `pbfilm_${randomUUID().replace(/-/g, '')}`;
    await initStatus(jobId);

    void (async () => {
      try {
        await runWithPodcastFilmInfrastructureRetries({
          maxRetries: getPodcastFilmInfrastructureMaxRetries(),
          operation: async ({ attempt }) => {
            if (attempt > 0) {
              await setPhase(
                jobId,
                'fetch_voices_images',
                `Retrying after infrastructure restart (${attempt}/${getPodcastFilmInfrastructureMaxRetries()})…`
              );
            }
            await runBackgroundPipeline(jobId, config, publicBaseUrl, internalAppBaseUrl);
          },
          onRetry: async ({ error, nextAttempt, maxRetries }) => {
            console.warn(
              `[podcast-film] job ${jobId} infrastructure retry ${nextAttempt}/${maxRetries}: ${describeError(error)}`
            );
            await setPhase(
              jobId,
              'fetch_voices_images',
              `Infrastructure error. Restarting Docker containers and retrying ${nextAttempt}/${maxRetries}…`
            );
          },
          restartInfrastructure: async ({ error }) => {
            await restartPodcastFilmInfrastructure(error);
          },
          ensureReady: async ({ error }) => {
            await ensurePodcastFilmInfrastructureReadyAfterRestart(ttsEngine, error);
          },
        });
      } catch (error) {
        console.error(`[podcast-film] job ${jobId} failed:`, error);
        const cur = await readStatus(jobId);
        if (error instanceof PipelineInputError) {
          await markFailed(
            jobId,
            String(error.body.detail ?? error.body.error ?? error.message),
            cur?.phase ?? null
          );
          return;
        }
        await markFailed(jobId, describeError(error), cur?.phase ?? null);
      } finally {
        infrastructureLease.release();
      }
    })();

    return NextResponse.json(
      {
        success: true,
        pipeline: 'podcast-film-v1',
        tts_engine: ttsEngine,
        avatar_provider: avatarProvider,
        review_mode: reviewMode,
        soulx_model: soulxModel,
        use_face_crop: useFaceCrop,
        image_rotation_seed: imageRotationSeed,
        job_id: jobId,
        status_url: `${publicBaseUrl}/api/podcast-video/podcast-film/jobs/${jobId}/status`,
        voice1,
        voice2,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('[podcast-film] job setup failed:', error);
    return NextResponse.json(
      { error: 'Pipeline B job setup failed.', detail: String(error) },
      { status: 500 }
    );
  }
}
