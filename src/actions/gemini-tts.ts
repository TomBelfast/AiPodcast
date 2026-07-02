'use server';

import { GoogleGenAI } from '@google/genai';
import { CreateDialogueRequest, DialogueInput, Err, Ok, Result } from '@/types';
import type { GeminiStyle, GeminiTempo } from '@/lib/podcast/contracts';

const GEMINI_TTS_DEFAULT_MODEL = 'gemini-3.1-flash-tts-preview';
const OPENROUTER_GEMINI_TTS_DEFAULT_MODEL = 'google/gemini-3.1-flash-tts-preview';
const OPENROUTER_TTS_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
const GEMINI_TTS_SAMPLE_RATE = 24000;
const GEMINI_TTS_BITS_PER_SAMPLE = 16;
const GEMINI_TTS_CHANNELS = 1;
const GEMINI_TTS_MAX_ATTEMPTS = 3;
const GEMINI_TTS_RETRY_BASE_DELAY_MS = 900;

interface GeminiSpeakerConfig {
  speaker: string;
  voiceName: string;
}

function normalizeLanguageCode(value: string | undefined): string {
  return String(value || 'en')
    .trim()
    .toLowerCase()
    .replace('_', '-');
}

function resolveLanguageName(languageCode: string): string {
  const normalized = normalizeLanguageCode(languageCode);
  if (normalized.startsWith('pl')) return 'Polish';
  if (normalized.startsWith('en')) return 'English';
  if (normalized.startsWith('de')) return 'German';
  if (normalized.startsWith('fr')) return 'French';
  if (normalized.startsWith('es')) return 'Spanish';
  if (normalized.startsWith('it')) return 'Italian';
  if (normalized.startsWith('pt')) return 'Portuguese';
  return 'the target language';
}

const GEMINI_ALLOWED_EXPRESSIVE_CUES = new Map<string, string>([
  ['laughing', '[laughing]'],
  ['sigh', '[sigh]'],
  ['uhm', '[uhm]'],
  ['short pause', '[short pause]'],
]);

interface GeminiInlinePart {
  inlineData?: {
    data?: string | Uint8Array;
  };
  inline_data?: {
    data?: string | Uint8Array;
  };
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiInlinePart[];
  };
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
}

export interface GeminiDialogueResult {
  audioBase64?: string;
  processingTimeMs: number;
  mimeType: 'audio/wav';
  model: string;
  provider: 'gemini' | 'openrouter';
  dryRun?: boolean;
  debug: {
    prompt: string;
    speakerVoiceConfigs: GeminiSpeakerConfig[];
    inputCount: number;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getGeminiTtsErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const details = [error.message];
    const nestedCause =
      typeof (error as Error & { cause?: unknown }).cause === 'object'
        ? ((error as Error & { cause?: { message?: unknown } }).cause ?? null)
        : null;

    if (nestedCause?.message) {
      details.push(String(nestedCause.message));
    }

    return details.join(' | ');
  }

  return String(error);
}

function isRetryableGeminiTtsError(error: unknown): boolean {
  const message = getGeminiTtsErrorMessage(error).toLowerCase();

  return (
    message.includes('"code":500') ||
    message.includes('"status":"internal"') ||
    message.includes('internal error encountered') ||
    message.includes('"code":503') ||
    message.includes('service unavailable') ||
    message.includes('unavailable') ||
    message.includes('resource_exhausted') ||
    message.includes('"code":429') ||
    message.includes('rate limit') ||
    message.includes('deadline exceeded') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('socket hang up') ||
    message.includes('econnreset') ||
    message.includes('fetch failed')
  );
}

function buildSpeakerAssignments(inputs: DialogueInput[]): Result<{
  transcriptLines: string[];
  speakerVoiceConfigs: GeminiSpeakerConfig[];
}> {
  const speakerByVoice = new Map<string, GeminiSpeakerConfig>();
  const transcriptLines: string[] = [];

  for (const input of inputs) {
    const voiceName = input.voiceId?.trim();
    const text = input.text?.trim();

    if (!voiceName || !text) {
      return Err('Each Gemini input must include text and a voice name.');
    }

    let speakerConfig = speakerByVoice.get(voiceName);
    if (!speakerConfig) {
      if (speakerByVoice.size >= 2) {
        return Err('Gemini TTS currently supports up to 2 speakers in this integration.');
      }

      speakerConfig = {
        speaker: `Speaker${speakerByVoice.size + 1}`,
        voiceName,
      };
      speakerByVoice.set(voiceName, speakerConfig);
    }

    transcriptLines.push(`${speakerConfig.speaker}: ${text}`);
  }

  return Ok({
    transcriptLines,
    speakerVoiceConfigs: Array.from(speakerByVoice.values()),
  });
}

function resolveGeminiStyle(request: CreateDialogueRequest): GeminiStyle {
  return request.geminiStyle || request.tts?.geminiStyle || 'expressive-lite';
}

function resolveGeminiTempo(request: CreateDialogueRequest): GeminiTempo {
  return request.geminiTempo || request.tts?.geminiTempo || 'fast';
}

function sanitizeGeminiText(text: string, style: GeminiStyle): string {
  const sanitized = text.replace(/\[([^\]]+)\]/g, (_, rawCue: string) => {
    const normalizedCue = rawCue.trim().toLowerCase().replace(/\s+/g, ' ');
    if (style === 'plain') {
      return '';
    }
    return GEMINI_ALLOWED_EXPRESSIVE_CUES.get(normalizedCue) || '';
  });

  return sanitized.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

function buildDirectorNotes(args: {
  speakerVoiceConfigs: GeminiSpeakerConfig[];
  style: GeminiStyle;
  tempo: GeminiTempo;
  includeVoiceCasting: boolean;
  languageCode: string;
}): string[] {
  const normalizedLanguage = normalizeLanguageCode(args.languageCode);
  const languageName = resolveLanguageName(normalizedLanguage);
  const notes: string[] = [
    `Read the following podcast script in ${languageName} exactly as written.`,
    'Do not add narration, explanations, scene setting, or extra words.',
    'Never read speaker labels aloud.',
    'Treat bracketed cues as performance direction only. Never speak the brackets literally.',
  ];

  if (normalizedLanguage.startsWith('en')) {
    notes.push(
      'Use natural, polished English pronunciation. Avoid Polish phonetics or Slavic vowel coloring.',
      'Lean slightly British in accent and prosody, but keep it subtle, modern, and credible for a tech podcast.'
    );
  }

  if (args.style === 'plain') {
    notes.push(
      'Keep the delivery clean, natural, and neutral-conversational.',
      'Do not overact. Keep reactions subtle even if the text contains expressive punctuation.'
    );
  } else {
    notes.push(
      'Use lively, energetic podcast delivery with a clear vocal smile and crisp turn-taking.',
      'Keep the performance expressive but controlled. Do not shout, do not become theatrical, and do not exaggerate laughter.',
      'Only use these light delivery cues when present in the text: [laughing], [sigh], [uhm], [short pause].'
    );
  }

  const hasKoreVoice = args.speakerVoiceConfigs.some(
    (config) => config.voiceName.trim().toLowerCase() === 'kore'
  );
  if (hasKoreVoice && args.style !== 'plain') {
    notes.push(
      'For voice Kore, use a slightly faster, clipped, dry delivery with very short pauses.',
      'Kore should sound like a quick skeptical counterpunch, not a slow explanatory narrator.'
    );
  }

  if (args.tempo === 'fast') {
    notes.push(
      'Use brisk, energetic pacing with minimal dead air.',
      'Keep pauses short and transitions quick, but preserve natural Polish pronunciation and intelligibility.'
    );
  } else {
    notes.push(
      'Use natural conversational pacing with steady momentum and short purposeful pauses.'
    );
  }

  if (args.includeVoiceCasting) {
    notes.push(
      `Voice casting: ${args.speakerVoiceConfigs
        .map((config) => `${config.speaker} uses voice ${config.voiceName}`)
        .join(', ')}.`
    );
  }

  return notes;
}

function buildGeminiPrompt(
  inputs: DialogueInput[],
  speakerVoiceConfigs: GeminiSpeakerConfig[],
  style: GeminiStyle,
  tempo: GeminiTempo,
  languageCode: string
): string {
  const sanitizedInputs = inputs.map((input) => ({
    ...input,
    text: sanitizeGeminiText(input.text.trim(), style),
  }));
  const directorNotes = buildDirectorNotes({
    speakerVoiceConfigs,
    style,
    tempo,
    includeVoiceCasting: speakerVoiceConfigs.length > 0,
    languageCode,
  });

  const transcript = sanitizedInputs
    .map((input) => {
      const matchingSpeaker = speakerVoiceConfigs.find((config) => config.voiceName === input.voiceId)?.speaker || 'Speaker1';
      return `${matchingSpeaker}: ${input.text}`;
    })
    .join('\n');

  return [
    ...directorNotes,
    '',
    transcript,
  ].join('\n');
}

function pcmToWav(pcmData: Buffer): Buffer {
  const bytesPerSample = GEMINI_TTS_BITS_PER_SAMPLE / 8;
  const blockAlign = GEMINI_TTS_CHANNELS * bytesPerSample;
  const byteRate = GEMINI_TTS_SAMPLE_RATE * blockAlign;
  const dataSize = pcmData.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(GEMINI_TTS_CHANNELS, 22);
  buffer.writeUInt32LE(GEMINI_TTS_SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(GEMINI_TTS_BITS_PER_SAMPLE, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmData.copy(buffer, 44);

  return buffer;
}

function extractInlineAudioData(response: GeminiGenerateContentResponse): Buffer | null {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const inlineData = part?.inlineData || part?.inline_data;
      const data = inlineData?.data;

      if (!data) {
        continue;
      }

      if (typeof data === 'string') {
        return Buffer.from(data, 'base64');
      }

      if (data instanceof Uint8Array) {
        return Buffer.from(data);
      }
    }
  }

  return null;
}

async function fetchOpenRouterSpeechSegment(args: {
  apiKey: string;
  model: string;
  prompt: string;
  voiceName: string;
}): Promise<Buffer> {
  const response = await fetch(OPENROUTER_TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || process.env.NEXT_PUBLIC_APP_URL || 'https://matrix.aihub.ovh',
      'X-Title': 'Matrix Podcast TTS',
    },
    body: JSON.stringify({
      model: args.model,
      input: args.prompt,
      response_format: 'pcm',
      voice: args.voiceName,
    }),
    signal: AbortSignal.timeout(3 * 60 * 1000),
  });

  const audio = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    const detail = audio.toString('utf8').slice(0, 800);
    throw new Error(`OpenRouter TTS HTTP ${response.status}: ${detail}`);
  }

  if (audio.length === 0) {
    throw new Error('OpenRouter TTS returned empty audio.');
  }

  return audio;
}

export async function createOpenRouterGeminiDialogue(
  request: CreateDialogueRequest
): Promise<Result<GeminiDialogueResult>> {
  const startTime = performance.now();
  const apiKey = request.apiKey;

  const assignmentResult = buildSpeakerAssignments(request.inputs);
  if (!assignmentResult.ok) {
    return assignmentResult;
  }

  const { speakerVoiceConfigs } = assignmentResult.value;
  const style = resolveGeminiStyle(request);
  const tempo = resolveGeminiTempo(request);
  const languageCode = normalizeLanguageCode(request.language);
  const plainText = sanitizeGeminiText((request.inputs[0]?.text || "").trim(), resolveGeminiStyle(request));
  const prompt = buildGeminiPrompt(request.inputs, speakerVoiceConfigs, style, tempo, languageCode);
  const model = request.modelId || OPENROUTER_GEMINI_TTS_DEFAULT_MODEL;
  const voiceName = speakerVoiceConfigs[0]?.voiceName || 'Charon';

  if (request.dryRun) {
    return Ok({
      processingTimeMs: Math.round(performance.now() - startTime),
      mimeType: 'audio/wav',
      model,
      provider: 'openrouter',
      dryRun: true,
      debug: {
        prompt,
        speakerVoiceConfigs,
        inputCount: request.inputs.length,
      },
    });
  }

  if (!apiKey) {
    return Err('OpenRouter API key is missing.');
  }

  try {
    let pcmAudio: Buffer | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= GEMINI_TTS_MAX_ATTEMPTS; attempt += 1) {
      try {
        pcmAudio = await fetchOpenRouterSpeechSegment({
          apiKey,
          model,
          prompt: plainText,
          voiceName,
        });
        lastError = null;
        break;
      } catch (error: unknown) {
        lastError = error;
        const retryable = isRetryableGeminiTtsError(error);
        if (!retryable || attempt === GEMINI_TTS_MAX_ATTEMPTS) {
          throw error;
        }

        const delayMs = GEMINI_TTS_RETRY_BASE_DELAY_MS * attempt;
        console.warn(
          `[OpenRouter Gemini TTS] attempt ${attempt}/${GEMINI_TTS_MAX_ATTEMPTS} failed, retrying in ${delayMs}ms: ${getGeminiTtsErrorMessage(
            error
          )}`
        );
        await sleep(delayMs);
      }
    }

    if (!pcmAudio) {
      throw lastError instanceof Error ? lastError : new Error('OpenRouter TTS returned no audio.');
    }

    const wavBuffer = pcmToWav(pcmAudio);

    return Ok({
      audioBase64: `data:audio/wav;base64,${wavBuffer.toString('base64')}`,
      processingTimeMs: Math.round(performance.now() - startTime),
      mimeType: 'audio/wav',
      model,
      provider: 'openrouter',
      debug: {
        prompt,
        speakerVoiceConfigs,
        inputCount: request.inputs.length,
      },
    });
  } catch (error: unknown) {
    const message = getGeminiTtsErrorMessage(error);
    return Err(`OpenRouter TTS error: ${message}`);
  }
}

export async function createGeminiDialogue(
  request: CreateDialogueRequest
): Promise<Result<GeminiDialogueResult>> {
  const startTime = performance.now();
  const apiKey = request.apiKey;

  const assignmentResult = buildSpeakerAssignments(request.inputs);
  if (!assignmentResult.ok) {
    return assignmentResult;
  }

  const { speakerVoiceConfigs } = assignmentResult.value;
  const style = resolveGeminiStyle(request);
  const tempo = resolveGeminiTempo(request);
  const languageCode = normalizeLanguageCode(request.language);
  const prompt = buildGeminiPrompt(request.inputs, speakerVoiceConfigs, style, tempo, languageCode);
  const model = request.modelId || GEMINI_TTS_DEFAULT_MODEL;

  if (request.dryRun) {
    return Ok({
      processingTimeMs: Math.round(performance.now() - startTime),
      mimeType: 'audio/wav',
      model,
      provider: 'gemini',
      dryRun: true,
      debug: {
        prompt,
        speakerVoiceConfigs,
        inputCount: request.inputs.length,
      },
    });
  }

  if (!apiKey) {
    return Err('Gemini API key is missing.');
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const speechSpeakerVoiceConfigs =
      speakerVoiceConfigs.length === 1
        ? [
            speakerVoiceConfigs[0],
            {
              speaker: 'Speaker2',
              voiceName: speakerVoiceConfigs[0].voiceName,
            },
          ]
        : speakerVoiceConfigs;
    const speechConfig = {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: speechSpeakerVoiceConfigs.map((config) => ({
          speaker: config.speaker,
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: config.voiceName,
            },
          },
        })),
      },
    };

    let response: GeminiGenerateContentResponse | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= GEMINI_TTS_MAX_ATTEMPTS; attempt += 1) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig,
          },
        });
        lastError = null;
        break;
      } catch (error: unknown) {
        lastError = error;
        const retryable = isRetryableGeminiTtsError(error);
        if (!retryable || attempt === GEMINI_TTS_MAX_ATTEMPTS) {
          throw error;
        }

        const delayMs = GEMINI_TTS_RETRY_BASE_DELAY_MS * attempt;
        console.warn(
          `[Gemini TTS] attempt ${attempt}/${GEMINI_TTS_MAX_ATTEMPTS} failed, retrying in ${delayMs}ms: ${getGeminiTtsErrorMessage(
            error
          )}`
        );
        await sleep(delayMs);
      }
    }

    if (!response) {
      throw lastError instanceof Error ? lastError : new Error('Gemini TTS returned no response.');
    }

    const pcmAudio = extractInlineAudioData(response);
    if (!pcmAudio) {
      return Err('Gemini TTS returned no inline audio data.');
    }

    const wavBuffer = pcmToWav(pcmAudio);

    return Ok({
      audioBase64: `data:audio/wav;base64,${wavBuffer.toString('base64')}`,
      processingTimeMs: Math.round(performance.now() - startTime),
      mimeType: 'audio/wav',
      model,
      provider: 'gemini',
      debug: {
        prompt,
        speakerVoiceConfigs,
        inputCount: request.inputs.length,
      },
    });
  } catch (error: unknown) {
    const message = getGeminiTtsErrorMessage(error);
    return Err(`Gemini TTS error: ${message}`);
  }
}
