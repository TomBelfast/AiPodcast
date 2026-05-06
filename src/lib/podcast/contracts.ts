import type { NormalizedTranscript } from '@/lib/transcript-parser';

export type InputMode = 'raw_text' | 'conversation';
export type ReviewMode = 'off' | 'pause_after_conversation';
export type TtsProvider = 'elevenlabs' | 'gemini' | 'omnivoice';
export type AvatarProvider = 'soulx';
export type GeminiStyle = 'plain' | 'expressive-lite';
export type GeminiTempo = 'normal' | 'fast';

export interface ConversationDraftItem {
  speaker: string;
  text: string;
}

export interface ConversationDraft {
  conversation: ConversationDraftItem[];
}

export interface CanonicalTtsConfig {
  provider: TtsProvider;
  voice1?: string | null;
  voice2?: string | null;
  model?: string | null;
  apiKey?: string | null;
  geminiStyle?: GeminiStyle | null;
  geminiTempo?: GeminiTempo | null;
}

export interface CanonicalAvatarConfig {
  provider: AvatarProvider;
  model?: string | null;
}

export interface CanonicalReviewConfig {
  mode: ReviewMode;
}

export interface CanonicalPodcastPublicInput {
  inputMode: InputMode | null;
  rawText: string | null;
  conversation: ConversationDraftItem[];
  legacyTranscript?: NormalizedTranscript;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

export function findNestedObject(
  source: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const candidate = source[key];
  return isPlainObject(candidate) ? candidate : null;
}

export function collectCandidateObjects(body: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [
    body,
    findNestedObject(body, 'payload'),
    findNestedObject(body, 'data'),
    findNestedObject(body, 'request'),
  ].filter((value): value is Record<string, unknown> => Boolean(value));

  return candidates.filter(
    (candidate, index) => candidates.findIndex((item) => item === candidate) === index
  );
}

export function pickString(
  candidates: Record<string, unknown>[],
  keys: string[]
): string | null {
  for (const candidate of candidates) {
    for (const key of keys) {
      const normalized = normalizeString(candidate[key]);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

export function pickBoolean(
  candidates: Record<string, unknown>[],
  keys: string[]
): boolean | null {
  for (const candidate of candidates) {
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
          return true;
        }
        if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
          return false;
        }
      }
    }
  }

  return null;
}

export function pickNumber(
  candidates: Record<string, unknown>[],
  keys: string[]
): number | null {
  for (const candidate of candidates) {
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
  }

  return null;
}

export function pickArray(
  candidates: Record<string, unknown>[],
  keys: string[]
): unknown[] | null {
  for (const candidate of candidates) {
    for (const key of keys) {
      const value = candidate[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
  }

  return null;
}

export function pickObject(
  candidates: Record<string, unknown>[],
  keys: string[]
): Record<string, unknown> | null {
  for (const candidate of candidates) {
    for (const key of keys) {
      const value = candidate[key];
      if (isPlainObject(value)) {
        return value;
      }
    }
  }

  return null;
}

export function normalizeConversationDraft(input: unknown): ConversationDraftItem[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [];
  }

  return input
    .map((item) => {
      if (!isPlainObject(item)) {
        return null;
      }

      const speaker =
        normalizeString(item.speaker) ||
        normalizeString(item.name) ||
        normalizeString(item.role) ||
        'Speaker1';
      const text =
        normalizeString(item.text) ||
        normalizeString(item.content) ||
        normalizeString(item.message);

      if (!text) {
        return null;
      }

      return {
        speaker,
        text,
      };
    })
    .filter((item): item is ConversationDraftItem => Boolean(item));
}

export function normalizeInputMode(
  rawText: string | null,
  conversation: ConversationDraftItem[]
): InputMode | null {
  if (rawText && conversation.length > 0) {
    return null;
  }

  if (rawText) {
    return 'raw_text';
  }

  if (conversation.length > 0) {
    return 'conversation';
  }

  return null;
}

export function normalizeTtsProvider(
  value: unknown,
  fallback: TtsProvider = 'elevenlabs'
): TtsProvider {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'gemini') {
    return 'gemini';
  }
  if (normalized === 'omnivoice') {
    return 'omnivoice';
  }
  return normalized === 'elevenlabs' ? 'elevenlabs' : fallback;
}

export function normalizeAvatarProvider(
  value: unknown,
  fallback: AvatarProvider = 'soulx'
): AvatarProvider {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'soulx' ? 'soulx' : fallback;
}

export function normalizeReviewMode(value: unknown): ReviewMode {
  return String(value || '').trim().toLowerCase() === 'pause_after_conversation'
    ? 'pause_after_conversation'
    : 'off';
}

export function normalizeGeminiStyle(value: unknown): GeminiStyle {
  return String(value || '').trim().toLowerCase() === 'plain'
    ? 'plain'
    : 'expressive-lite';
}

export function normalizeGeminiTempo(value: unknown): GeminiTempo {
  return String(value || '').trim().toLowerCase() === 'normal'
    ? 'normal'
    : 'fast';
}
