import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { Agent, fetch as undiciFetch } from 'undici';
import { isPodcastVideoAuthorized, resolvePublicBaseUrl } from '@/lib/podcast-video/http';
import {
  ensurePodcastVideoArchiveDir,
  buildPodcastVideoFileUrl,
  getPodcastVideoJobPaths,
} from '@/lib/podcast-video/archive';
import {
  initStatus,
  setPhase,
  markDone,
  markFailed,
  readStatus,
} from '@/lib/podcast-video/job-status';

const OMNIVOICE_JOB_TIMEOUT_MS = 15 * 60 * 1000;
const WORKER_PROBE_TIMEOUT_MS = 2500;
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
  process.env.SOULX_BASE_URL?.trim() || 'http://192.168.0.13:7000';

type Segment = { speaker: string; text: string };
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
  soulxModel: 'pro' | 'lite';
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
};
type PreparedPipelineInput = {
  segments: Segment[];
  voiceRegistry: Map<string, VoiceEntry>;
  maleVoice: string;
  femaleVoice: string;
  voicesSwapped: boolean;
};
type WorkerProbeResult = {
  service: 'omnivoice' | 'soulx';
  ok: boolean;
  url: string;
  detail: string;
  status?: number;
};

class PipelineInputError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error ?? body.detail ?? 'Pipeline input failed.'));
    this.status = status;
    this.body = body;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getInternalAppBaseUrl(): string {
  return (
    process.env.INTERNAL_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://127.0.0.1:3300'
  )
    .trim()
    .replace(/\/+$/, '');
}

function normalizeConversationItems(conversation: unknown): ConversationItem[] {
  if (!Array.isArray(conversation) || conversation.length === 0) {
    return [];
  }

  return conversation
    .map((item) => {
      if (!isPlainObject(item)) {
        return null;
      }

      const speaker = String(item.speaker ?? item.role ?? item.name ?? '').trim();
      const text = String(item.text ?? item.content ?? '').replace(/\s+/g, ' ').trim();
      if (!text) {
        return null;
      }

      return {
        speaker: speaker || 'Speaker1',
        text,
      };
    })
    .filter((item): item is ConversationItem => Boolean(item));
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

async function parseConversationStream(response: Response): Promise<ConversationItem[]> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Generator conversation stream is unavailable.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finalConversation: ConversationItem[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const parsed = JSON.parse(trimmed) as {
        type?: string;
        error?: string;
        data?: { conversation?: unknown };
      };

      if (parsed.type === 'error') {
        throw new Error(parsed.error || 'Conversation generation failed.');
      }

      if (parsed.type === 'complete') {
        finalConversation = normalizeConversationItems(parsed.data?.conversation);
      }
    }
  }

  if (buffer.trim()) {
    const parsed = JSON.parse(buffer.trim()) as {
      type?: string;
      error?: string;
      data?: { conversation?: unknown };
    };

    if (parsed.type === 'error') {
      throw new Error(parsed.error || 'Conversation generation failed.');
    }

    if (parsed.type === 'complete') {
      finalConversation = normalizeConversationItems(parsed.data?.conversation);
    }
  }

  return finalConversation;
}

async function generateSegmentsFromRawText(
  transcript: string,
  title: string,
  language: string,
  maleVoice: string,
  femaleVoice: string
): Promise<Segment[]> {
  const response = await fetch(`${getInternalAppBaseUrl()}/api/generate-podcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: transcript,
      title,
      language,
      ttsEngine: 'omnivoice',
    }),
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Conversation generation failed: ${errorText.slice(0, 500)}`);
  }

  const conversation = await parseConversationStream(response);
  return conversation.map((item) => ({
    speaker: resolveVoiceForSpeaker(item.speaker, maleVoice, femaleVoice),
    text: item.text,
  }));
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
      return {
        service: 'soulx',
        ok: false,
        url,
        detail: `probe failed: ${describeError(error)}`,
      };
    }
  }

  return {
    service: 'soulx',
    ok: false,
    url: candidates[0],
    detail: `reachable endpoint not found (${details.join('; ')})`,
  };
}

async function runWorkerPreflightChecks(): Promise<WorkerProbeResult[]> {
  return Promise.all([probeOmniVoiceReadiness(), probeSoulXReadiness()]);
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
function stripTtsInlineTags(text: string): string {
  return text
    .replace(BRACKETED_TAG_PATTERN, ' ')
    .replace(/\s*—\s*/g, ' ')
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

function formatSrtTimestamp(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function formatAssTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.round((total - Math.floor(total)) * 100);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs, 2)}`;
}

// Port of Pipeline A reconciliation. Strip edge punctuation, lowercase for
// comparison; display text keeps original spelling (dialect preserved).
const EDGE_PUNCTUATION_PATTERN = /^[.,!?;:()[\]{}"„"'«»…–—-]+|[.,!?;:()[\]{}"„"'«»…–—-]+$/g;
function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
function normalizeComparableToken(value: string): string {
  return normalizeText(value).replace(EDGE_PUNCTUATION_PATTERN, '').toLocaleLowerCase('pl-PL');
}

type WhisperWord = { text: string; start: number; end: number };
type DisplayToken = {
  id: number;
  segmentIndex: number;
  text: string;
  startTime: number;
  endTime: number;
};

// Given a script (original spelling) and Whisper-transcribed words (possibly
// wrong text on dialects), return tokens that keep script spelling but use
// Whisper timings. Unmatched tail tokens get a proportional slice of remaining
// segment time.
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
    .map((w) => ({ ...w, norm: normalizeComparableToken(w.text) }))
    .filter((w) => w.norm.length > 0);

  const tokens: DisplayToken[] = [];
  let wIdx = 0;
  let matched = 0;
  for (let i = 0; i < rawTokens.length; i++) {
    const scriptToken = rawTokens[i];
    const scriptNorm = normalizeComparableToken(scriptToken);
    if (!scriptNorm) continue;
    let hit: (typeof cleanWhisper)[0] | null = null;
    for (let j = wIdx; j < Math.min(wIdx + 3, cleanWhisper.length); j++) {
      const w = cleanWhisper[j];
      if (
        scriptNorm === w.norm ||
        scriptNorm.includes(w.norm) ||
        w.norm.includes(scriptNorm)
      ) {
        hit = w;
        wIdx = j + 1;
        break;
      }
    }
    if (hit) {
      tokens.push({
        id: idOffset + i,
        segmentIndex,
        text: scriptToken,
        startTime: segmentStartTime + hit.start,
        endTime: segmentStartTime + hit.end,
      });
      matched++;
    } else {
      tokens.push({
        id: idOffset + i,
        segmentIndex,
        text: scriptToken,
        startTime: Number.NaN,
        endTime: Number.NaN,
      });
    }
  }

  // Fill NaN timings: interpolate between last matched time before and next
  // matched time after (or segment bounds). Ensures every script token shows.
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
    const gap = Math.max(0.05, nextTime - lastGood);
    const span = nextIdx - i;
    const per = gap / span;
    for (let k = i; k < nextIdx; k++) {
      tokens[k].startTime = lastGood + per * (k - i);
      tokens[k].endTime = lastGood + per * (k - i + 1);
    }
    i = nextIdx - 1;
    lastGood = nextTime;
  }

  return { tokens, matched, unmatched: tokens.length - matched };
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

type CaptionStyle = {
  fontSize: number;
  lineColor: string;
  wordColor: string;
  outlineColor: string;
  marginV: number;
  marginX: number;
  playResX: number;
  playResY: number;
  fontName: string;
  visibleWords: number;
};

function hexToAssColor(hex: string): string {
  const cleaned = hex.replace('#', '').padStart(6, '0');
  const rr = cleaned.slice(0, 2);
  const gg = cleaned.slice(2, 4);
  const bb = cleaned.slice(4, 6);
  return `&H00${bb}${gg}${rr}&`;
}
function escapeAssText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\N').replace(/\{/g, '(').replace(/\}/g, ')');
}

function buildLineLimits(fontSize: number) {
  if (fontSize >= 88) return { maxWordsPerLine: 4, maxCharsPerLine: 24 };
  if (fontSize >= 72) return { maxWordsPerLine: 5, maxCharsPerLine: 30 };
  if (fontSize >= 48) return { maxWordsPerLine: 6, maxCharsPerLine: 36 };
  return { maxWordsPerLine: 6, maxCharsPerLine: 32 };
}

function splitTokensIntoLines(tokens: DisplayToken[], fontSize: number): DisplayToken[][] {
  const { maxWordsPerLine, maxCharsPerLine } = buildLineLimits(fontSize);
  const lines: DisplayToken[][] = [];
  let cur: DisplayToken[] = [];
  let curLen = 0;
  for (const t of tokens) {
    const nextLen = curLen + t.text.length + (cur.length ? 1 : 0);
    const tooWords = cur.length >= maxWordsPerLine;
    const tooChars = cur.length > 0 && nextLen > maxCharsPerLine;
    if (cur.length > 0 && (tooWords || tooChars)) {
      lines.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(t);
    curLen += t.text.length + (cur.length > 1 ? 1 : 0);
  }
  if (cur.length) lines.push(cur);
  return lines.length ? lines : [[]];
}

function buildAssHeader(style: CaptionStyle): string {
  const primaryColor = hexToAssColor(style.lineColor);
  const outlineColor = hexToAssColor(style.outlineColor);
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${style.playResX}`,
    `PlayResY: ${style.playResY}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 2',
    'Collisions: Normal',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${style.fontName},${style.fontSize},${primaryColor},${primaryColor},${outlineColor},&H00000000&,1,0,0,0,100,100,0,0,1,2,0,8,${style.marginX},${style.marginX},${style.marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
}

const toCaptionCase = (s: string) => s.toLocaleUpperCase('pl-PL');

// Highlight: at each active word, show up to `visibleWords` recent words;
// paint the current word in wordColor, others in lineColor.
function buildHighlightAss(tokens: DisplayToken[], style: CaptionStyle): string {
  const lines: string[] = [buildAssHeader(style)];
  if (tokens.length === 0) return lines.join('\n') + '\n';

  const activeHex = hexToAssColor(style.wordColor);
  const inactiveHex = hexToAssColor(style.lineColor);
  const visible = Math.max(1, style.visibleWords);

  const allLines = splitTokensIntoLines(tokens, style.fontSize);

  for (let i = 0; i < tokens.length; i++) {
    const active = tokens[i];
    const startIdx = Math.max(0, i - (visible - 1));
    const visibleIds = new Set<number>();
    for (let k = startIdx; k <= i; k++) visibleIds.add(tokens[k].id);

    const renderedLines: string[] = [];
    for (const line of allLines) {
      const pieces: string[] = [];
      for (const tok of line) {
        if (!visibleIds.has(tok.id)) continue;
        const display = escapeAssText(toCaptionCase(tok.text));
        if (tok.id === active.id) {
          pieces.push(`{\\c${activeHex}}${display}{\\c${inactiveHex}}`);
        } else {
          pieces.push(display);
        }
      }
      if (pieces.length) renderedLines.push(pieces.join(' '));
    }
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

function buildClassicAss(tokens: DisplayToken[], style: CaptionStyle): string {
  const lines: string[] = [buildAssHeader(style)];
  if (tokens.length === 0) return lines.join('\n') + '\n';

  // Group by segmentIndex, then split into cues ~2 lines each.
  const bySegment = new Map<number, DisplayToken[]>();
  for (const t of tokens) {
    const list = bySegment.get(t.segmentIndex) || [];
    list.push(t);
    bySegment.set(t.segmentIndex, list);
  }

  for (const segTokens of bySegment.values()) {
    const segLines = splitTokensIntoLines(segTokens, style.fontSize);
    for (let i = 0; i < segLines.length; i += 2) {
      const cueLines = segLines.slice(i, i + 2);
      const flat = cueLines.flat();
      if (!flat.length) continue;
      const cueStart = flat[0].startTime;
      const cueEnd = flat[flat.length - 1].endTime;
      const text = cueLines
        .map((line) => line.map((t) => escapeAssText(toCaptionCase(t.text))).join(' '))
        .join('\\N');
      lines.push(
        `Dialogue: 0,${formatAssTime(cueStart)},${formatAssTime(cueEnd)},Default,,0,0,${style.marginV},,${text}`
      );
    }
  }

  return lines.join('\n') + '\n';
}

const COVER_TEMPLATE_PATH = '/root/AiPodcast/podcast_cover.png';
const COVER_OVERLAY_Y = 420;
const COVER_OVERLAY_W = 1080;
const COVER_OVERLAY_H = 940;
const CAPTION_START_DELAY_SECONDS = 0.12;

function wrapTitleText(raw: string, maxCharsPerLine: number): string {
  const input = raw.replace(/\r\n?/g, '\n');
  const outLines: string[] = [];
  for (const paragraph of input.split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      outLines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      if (!current) {
        current = word;
        continue;
      }
      if ((current + ' ' + word).length <= maxCharsPerLine) {
        current += ' ' + word;
      } else {
        outLines.push(current);
        current = word;
      }
    }
    if (current) outLines.push(current);
  }
  return outLines.join('\n');
}

async function compositeOnCover(
  concatMp4: string,
  outputMp4: string,
  titleTextFile: string | null
): Promise<{ elapsed_ms: number }> {
  const start = Date.now();
  const baseFilter = `[0:v]scale=${COVER_OVERLAY_W}:${COVER_OVERLAY_W}:flags=lanczos,crop=${COVER_OVERLAY_W}:${COVER_OVERLAY_H}:0:${(COVER_OVERLAY_W - COVER_OVERLAY_H) / 2}[fg];[1:v][fg]overlay=0:${COVER_OVERLAY_Y}`;
  const titleFilter = titleTextFile
    ? `,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile='${titleTextFile}':fontcolor=0x00FF04:fontsize=64:x=(w-text_w)/2:y=1512-text_h/2:line_spacing=10:box=0:enable='between(t,0,${CAPTION_START_DELAY_SECONDS})'`
    : '';
  const filterComplex = baseFilter + titleFilter;
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-i', concatMp4,
      '-i', COVER_TEMPLATE_PATH,
      '-filter_complex',
      filterComplex,
      '-map', '0:a?',
      '-c:a', 'copy',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-shortest',
      outputMp4,
    ]);
    let stderr = '';
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg composite exit ${code}: ${stderr.slice(-600)}`));
    });
  });
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

// Port of Pipeline A's splitTokensIntoLines + groupLinesIntoCues: break long
// segment text into cues of ~2 lines × 6 words each, distribute segment
// duration proportionally by cue count.
function splitSegmentIntoCues(
  text: string,
  startTime: number,
  endTime: number,
  maxWordsPerLine = 6,
  maxCharsPerLine = 32,
  linesPerCue = 2
): Array<{ start: number; end: number; text: string }> {
  const tokens = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (tokens.length === 0) return [];

  const lines: string[][] = [];
  let cur: string[] = [];
  let curLen = 0;
  for (const t of tokens) {
    const nextLen = curLen + t.length + (cur.length ? 1 : 0);
    const tooManyWords = cur.length >= maxWordsPerLine;
    const tooManyChars = cur.length > 0 && nextLen > maxCharsPerLine;
    if (cur.length > 0 && (tooManyWords || tooManyChars)) {
      lines.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(t);
    curLen += t.length + (cur.length > 1 ? 1 : 0);
  }
  if (cur.length) lines.push(cur);

  const totalCues = Math.max(1, Math.ceil(lines.length / linesPerCue));
  const duration = Math.max(0.12, endTime - startTime);
  const perCue = duration / totalCues;

  const cues: Array<{ start: number; end: number; text: string }> = [];
  for (let i = 0; i < lines.length; i += linesPerCue) {
    const cueIndex = i / linesPerCue;
    const cueLines = lines.slice(i, i + linesPerCue);
    const cueStart = startTime + perCue * cueIndex;
    const cueEnd =
      cueIndex === totalCues - 1 ? endTime : startTime + perCue * (cueIndex + 1);
    cues.push({
      start: cueStart,
      end: cueEnd,
      text: toCaptionCase(cueLines.map((line) => line.join(' ')).join('\n')),
    });
  }
  return cues;
}

function buildSrtFromSegments(
  segs: Array<{ text: string; duration_seconds: number }>,
  startOffsetSeconds = 0
): string {
  const lines: string[] = [];
  let cursor = startOffsetSeconds;
  let idx = 1;
  for (const seg of segs) {
    const cues = splitSegmentIntoCues(
      seg.text,
      cursor,
      cursor + seg.duration_seconds
    );
    for (const cue of cues) {
      lines.push(
        String(idx++),
        `${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}`,
        cue.text,
        ''
      );
    }
    cursor += seg.duration_seconds;
  }
  return lines.join('\n');
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
  'conversation' | 'transcript' | 'title' | 'language' | 'voice1' | 'voice2'
>): Promise<PreparedPipelineInput> {
  let voiceRegistry: Map<string, VoiceEntry>;
  try {
    voiceRegistry = await fetchVoiceRegistry();
  } catch (error) {
    throw new PipelineInputError(502, {
      error: 'Failed to fetch OmniVoice voice registry.',
      detail: describeError(error),
    });
  }

  const {
    maleVoice,
    femaleVoice,
    swapped: voicesSwapped,
  } = resolveGenderedVoicePair(config.voice1, config.voice2, voiceRegistry);

  let segments: Segment[] | null = segmentsFromConversation(
    config.conversation,
    maleVoice,
    femaleVoice
  );

  if (!segments && config.transcript) {
    segments = parseTranscriptToSegments(config.transcript, config.voice1, config.voice2);
  }

  if ((!segments || segments.length === 0) && config.transcript) {
    try {
      segments = await generateSegmentsFromRawText(
        config.transcript,
        config.title || 'Podcast Video',
        config.language,
        maleVoice,
        femaleVoice
      );
    } catch (error) {
      throw new PipelineInputError(502, {
        error: 'Failed to generate podcast conversation from raw text.',
        detail: describeError(error),
      });
    }
  }

  if (!segments || segments.length === 0) {
    throw new PipelineInputError(400, {
      error:
        'No segments produced from conversation[], speaker-marked transcript, or raw-text generation.',
    });
  }

  segments = segments
    .map((segment) => ({ ...segment, text: stripTtsInlineTags(segment.text) }))
    .filter((segment) => segment.text.length > 0);

  if (segments.length === 0) {
    throw new PipelineInputError(400, {
      error: 'All segments were empty after TTS sanitization.',
    });
  }

  return {
    segments,
    voiceRegistry,
    maleVoice,
    femaleVoice,
    voicesSwapped,
  };
}

async function runBackgroundPipeline(
  jobId: string,
  config: PipelineConfig,
  publicBaseUrl: string
): Promise<void> {
  const paths = await ensurePodcastVideoArchiveDir(jobId);
  await fs.mkdir(paths.segmentsDir, { recursive: true });
  const workerUrl = `${OMNIVOICE_BASE_URL}/api/v1/podcast-film/jobs`;

  await setPhase(jobId, 'generate_podcast', 'Preparing dialogue and voices…');
  const prepared = await preparePipelineInput(config);
  const {
    segments,
    voiceRegistry,
    maleVoice,
    femaleVoice,
    voicesSwapped,
  } = prepared;

  await setPhase(jobId, 'fetch_voices_images', 'Loading avatar images…');
  const [womanFiles, menFiles] = await Promise.all([
    fetchImageList('Woman'),
    fetchImageList('Men'),
  ]);
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

  await setPhase(jobId, 'omnivoice_tts', 'Synthesizing voice audio…');
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
  const workerData = (await workerRes.json()) as {
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
  const workerElapsedMs = Date.now() - workerStartedAt;

  const totalSegs = workerData.manifest.segments.length;
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
    const seg = workerData.manifest.segments[i];
    const voice = voiceRegistry.get(seg.speaker.toLowerCase());
    if (!voice) {
      throw new Error(
        `Voice "${seg.speaker}" from OmniVoice manifest not found in /voices registry`
      );
    }
    const { folder, file } = pickImage(voice, cursors, snapshots, config.pinnedImages);
    const imageUrl = `${OMNIVOICE_BASE_URL}/images/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;
    const audioUrl = `${OMNIVOICE_BASE_URL}/api/v1/podcast-film/jobs/${encodeURIComponent(workerData.job_id)}/file?type=segment&name=${encodeURIComponent(seg.audio_file)}`;
    const [img, aud] = await Promise.all([fetchBytes(imageUrl), fetchBytes(audioUrl)]);
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
      text: segments[i].text,
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
    await fs.writeFile(titleTextFile, wrapTitleText(config.title, 28), 'utf8');
  }
  await compositeOnCover(concatMp4Path, compositeMp4Path, titleTextFile);
  const compositeElapsedMs = Date.now() - compositeStart;
  await fs.rename(compositeMp4Path, finalMp4Path);

  const srtBody = buildSrtFromSegments(
    segmentResults.map((segment) => ({
      text: segment.text,
      duration_seconds: segment.actual_duration_seconds,
    })),
    CAPTION_START_DELAY_SECONDS
  );
  const srtPath = getPodcastVideoJobPaths(jobId).srt;
  await fs.writeFile(srtPath, srtBody, 'utf8');
  const srtUrl = buildPodcastVideoFileUrl(publicBaseUrl, jobId, 'srt');

  let captionsElapsedMs: number | undefined;
  const captionWarnings: string[] = [];
  let matchedTotal = 0;
  let unmatchedTotal = 0;
  const globalTokens: DisplayToken[] = [];
  if (config.captionsMode === 'burn' && config.captionStyle !== 'off') {
    await setPhase(jobId, 'whisper_align', `Aligning word timing 0/${segmentResults.length}…`, {
      current: 0,
      total: segmentResults.length,
    });
    let cumulativeOffset = 0;
    let idCursor = 0;
    for (let i = 0; i < segmentResults.length; i++) {
      const segment = segmentResults[i];
      const manifestSeg = workerData.manifest.segments[i];
      const segDuration = segment.actual_duration_seconds;
      const segStart = cumulativeOffset;
      const segEnd = cumulativeOffset + segDuration;
      let whisperWords: WhisperWord[] = [];
      try {
        whisperWords = await transcribeSegmentWords(
          workerData.job_id,
          manifestSeg.audio_file,
          config.captionLanguage
        );
      } catch (error) {
        captionWarnings.push(
          `transcribe-words failed for ${manifestSeg.audio_file}: ${describeError(error).slice(0, 160)}`
        );
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
      cumulativeOffset = segEnd;
      await setPhase(
        jobId,
        'whisper_align',
        `Aligning word timing ${i + 1}/${segmentResults.length}…`,
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
      visibleWords: 2,
    };
    const assContent =
      config.captionStyle === 'highlight'
        ? buildHighlightAss(globalTokens, style)
        : buildClassicAss(globalTokens, style);
    const assPath = path.join(paths.dir, 'captions.ass');
    await fs.writeFile(assPath, assContent, 'utf8');
    if (globalTokens.length > 0) {
      await setPhase(jobId, 'burn_subs', 'Burning captions into video…');
      const tmpMp4 = path.join(paths.dir, 'final_captioned.mp4');
      const result = await burnAssOntoMp4(paths.dir, finalMp4Path, 'captions.ass', tmpMp4);
      captionsElapsedMs = result.elapsed_ms;
      await fs.rename(tmpMp4, finalMp4Path);
    } else {
      captionWarnings.push('no caption tokens produced — skipping burn');
    }
  }

  await markDone(jobId, {
    success: true,
    pipeline: 'podcast-film-v1',
    tts_engine: 'omnivoice',
    soulx_model: config.soulxModel,
    use_face_crop: config.useFaceCrop,
    image_rotation_seed: config.imageRotationSeed,
    job_id: jobId,
    omnivoice_job_id: workerData.job_id,
    voice1: config.voice1,
    voice2: config.voice2,
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
    caption_warnings: captionWarnings,
    caption_matched_words: matchedTotal,
    caption_unmatched_words: unmatchedTotal,
    transition: config.transition,
    transition_duration: config.transitionDuration,
    transition_skipped_reason: concatResult.transition_skipped_reason,
    final_duration_seconds: concatResult.final_duration_seconds,
    timings: {
      omnivoice_ms: workerElapsedMs,
      soulx_total_ms: renderElapsedMs,
      concat_ms: concatResult.elapsed_ms,
      concat_mode: concatResult.mode,
      composite_ms: compositeElapsedMs,
      captions_ms: captionsElapsedMs,
    },
    worker: {
      omnivoice_url: workerUrl,
      soulx_url: `${SOULX_BASE_URL}/generate`,
    },
    note: 'v1: per-segment MP4 + concat + word-level ASS captions burned via Whisper timing reconciliation.',
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

    const ttsEngine = String(body.tts_engine || 'omnivoice').toLowerCase();
    if (ttsEngine !== 'omnivoice') {
      return NextResponse.json(
        {
          error: `tts_engine "${ttsEngine}" not supported (v1). Use "omnivoice".`,
        },
        { status: 501 }
      );
    }

    const transcript = String(body.transcript || body.script_text || '').trim();
    const normalizedConversation = normalizeConversationItems(body.conversation);
    const language = String(body.language || body.caption_language || 'pl').trim() || 'pl';
    const voice1 = String(body.voice1 || 'host_a');
    const voice2 = String(body.voice2 || 'host_b');
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

    if (normalizedConversation.length === 0 && !transcript) {
      return NextResponse.json(
        {
          error:
            'No segments produced from conversation[], speaker-marked transcript, or raw-text generation.',
        },
        { status: 400 }
      );
    }

    const config: PipelineConfig = {
      conversation: normalizedConversation.length > 0 ? normalizedConversation : body.conversation,
      transcript,
      language,
      voice1,
      voice2,
      soulxModel,
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
    };

    if (dryRun) {
      try {
        const prepared = await preparePipelineInput(config);
        return NextResponse.json({
          success: true,
          pipeline: 'podcast-film-v1',
          dry_run: true,
          segments_count: prepared.segments.length,
          soulx_model: soulxModel,
          use_face_crop: useFaceCrop,
          voice1,
          voice2,
          male_voice: prepared.maleVoice,
          female_voice: prepared.femaleVoice,
          voices_swapped_for_gender: prepared.voicesSwapped,
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

    const workerChecks = await runWorkerPreflightChecks();
    const failedWorkerChecks = workerChecks.filter((check) => !check.ok);
    if (failedWorkerChecks.length > 0) {
      const detail = failedWorkerChecks
        .map((check) => `${check.service}: ${check.detail}`)
        .join(' | ');
      return NextResponse.json(
        {
          error: 'Podcast-film worker preflight failed.',
          detail,
          checks: workerChecks,
        },
        { status: 503 }
      );
    }

    const jobId = `pbfilm_${randomUUID().replace(/-/g, '')}`;
    await initStatus(jobId);
    const publicBaseUrl = resolvePublicBaseUrl(request);

    void (async () => {
      try {
        await runBackgroundPipeline(jobId, config, publicBaseUrl);
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
      }
    })();

    return NextResponse.json(
      {
        success: true,
        pipeline: 'podcast-film-v1',
        tts_engine: 'omnivoice',
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
