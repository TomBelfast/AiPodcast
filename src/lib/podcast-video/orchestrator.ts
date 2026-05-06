import path from 'path';
import { promises as fs } from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { createDialogue } from '@/actions/dialogue';
import { createGeminiDialogue } from '@/actions/gemini-tts';
import { getEffectiveAdminSettings } from '@/lib/admin-settings';
import {
  ensurePodcastVideoArchiveDir,
  fileExists,
  writeBufferFile,
  writeJsonFile,
  writeTextFile,
  buildPodcastVideoFileUrl,
} from '@/lib/podcast-video/archive';
import {
  failPodcastVideoJob,
  getPodcastVideoJob,
  setPodcastVideoJobStage,
  updatePodcastVideoJob,
} from '@/lib/podcast-video/jobs';
import { buildExactSrt, formatSrtTime, hasWordTimings } from '@/lib/podcast-video/exact-captions';
import { renderPodcastVideoLocally } from '@/lib/podcast-video/local-renderer';
import { uploadBufferToMinio, uploadFileToMinio } from '@/lib/podcast-video/minio';
import { composePodcastVideo, renderPodcastCaptions } from '@/lib/podcast-video/nca';
import { DEFAULT_GEMINI_VOICES } from '@/lib/voice-catalog';
import {
  DEFAULT_PODCAST_VIDEO_VOICES,
  type PodcastConversationItem,
  type PodcastVideoCaptionSettings,
  type PodcastVideoJobRequest,
  type PodcastVideoRenderMode,
} from '@/lib/podcast-video/types';
import {
  normalizeGeminiStyle,
  normalizeGeminiTempo,
  type GeminiStyle,
  type GeminiTempo,
  type TtsProvider,
} from '@/lib/podcast/contracts';
import {
  generateStems,
  generateIndividualSegments,
} from '@/lib/podcast-video/audio-splitter';
import {
  type NormalizedTranscript,
  parseElevenLabsTranscript,
} from '@/lib/transcript-parser';
import { getPodcastVideoCoverPath } from '@/lib/podcast-video/cover';
import { generateConversationDraft } from '@/lib/podcast/generate';

type PipelineVoiceSegment = {
  voice_id?: string | null;
  voiceId?: string | null;
  dialogue_input_index?: number | null;
  dialogueInputIndex?: number | null;
  start_time_seconds?: number | null;
  startTimeSeconds?: number | null;
  end_time_seconds?: number | null;
  endTimeSeconds?: number | null;
  character_start_index?: number | null;
  characterStartIndex?: number | null;
  character_end_index?: number | null;
  characterEndIndex?: number | null;
  speaker?: string | null;
};

type NormalizedVoiceSegment = {
  voiceId: string | null;
  dialogueInputIndex: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  characterStartIndex: number;
  characterEndIndex: number;
  speaker: string;
};

type PipelineAlignment = {
  characters?: string[];
  character_start_times_seconds?: number[];
  characterStartTimesSeconds?: number[];
  character_end_times_seconds?: number[];
  characterEndTimesSeconds?: number[];
} | null;

const CAPTION_NOISE_WORDS = new Set([
  'sigh',
  'sighs',
  'laughed',
  'laugh',
  'laughs',
  'chuckle',
  'chuckles',
  'chuckling',
  'gasp',
  'gasps',
  'pause',
  'pauses',
  'paused',
  'hesitate',
  'hesitates',
  'hesitating',
  'excited',
  'surprised',
  'skeptical',
  'thoughtful',
  'confused',
  'amazed',
  'eye',
  'roll',
  'eyeroll',
  'groan',
  'groans',
  'whisper',
  'whispers',
  'wzdycha',
  'wzdych',
  'westchnienie',
  'smiech',
  'śmiech',
  'smieje',
  'śmieje',
  'prycha',
  'pauza',
  'eh',
  'ehh',
  'eee',
  'yyy',
  'uh',
  'uhh',
  'um',
  'umm',
  'erm',
  'hmm',
  'mm',
]);

function normalizeCaptionToken(value: string): string {
  return value
    .toLocaleLowerCase('pl-PL')
    .replace(/^[^0-9\p{L}]+|[^0-9\p{L}]+$/gu, '')
    .trim();
}

function sanitizeCaptionText(value: string): string {
  return value
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\(([^)]*)\)/g, (_, inner: string) => {
      const trimmed = inner.replace(/\s+/g, ' ').trim();
      return trimmed.split(' ').length <= 5 ? ' ' : ` (${trimmed}) `;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldKeepCaptionWord(text: string): boolean {
  const normalized = normalizeCaptionToken(text);
  return Boolean(normalized) && !CAPTION_NOISE_WORDS.has(normalized);
}

function sanitizeTranscriptForCaptions(transcript: NormalizedTranscript): NormalizedTranscript {
  const filteredWordsBySegment = new Map<number, typeof transcript.words>();

  for (const word of transcript.words || []) {
    if (!shouldKeepCaptionWord(word.text || '')) {
      continue;
    }

    const list = filteredWordsBySegment.get(word.segment_id) || [];
    list.push(word);
    filteredWordsBySegment.set(word.segment_id, list);
  }

  const nextSegments: typeof transcript.segments = [];
  const nextWords: typeof transcript.words = [];
  let nextWordId = 0;

  for (const segment of transcript.segments || []) {
    const keptWords = filteredWordsBySegment.get(segment.id) || [];
    const fallbackText = sanitizeCaptionText(segment.text || '');
    const textFromWords = keptWords.map((word) => word.text).join(' ').replace(/\s+/g, ' ').trim();
    const nextText = textFromWords || fallbackText;

    if (!nextText) {
      continue;
    }

    const nextSegmentId = nextSegments.length;
    const nextSegmentStart = keptWords[0]?.start_time ?? segment.start_time;
    const nextSegmentEnd = keptWords.at(-1)?.end_time ?? segment.end_time;

    nextSegments.push({
      ...segment,
      id: nextSegmentId,
      start_time: nextSegmentStart,
      end_time: Math.max(nextSegmentStart, nextSegmentEnd),
      text: nextText,
    });

    for (const word of keptWords) {
      nextWords.push({
        ...word,
        id: nextWordId,
        segment_id: nextSegmentId,
      });
      nextWordId += 1;
    }
  }

  const fullText = nextSegments
    .map((segment) => segment.text)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    ...transcript,
    segments: nextSegments,
    words: nextWords,
    full_text: fullText,
    warnings: [
      ...(Array.isArray(transcript.warnings) ? transcript.warnings : []),
      'captions_filtered_for_stage_directions',
    ],
  };
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  return Buffer.from(base64, 'base64');
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function resolveRequestedTtsProvider(request: PodcastVideoJobRequest): TtsProvider {
  const normalized = String(request.tts?.provider || 'elevenlabs').trim().toLowerCase();
  if (normalized === 'gemini') {
    return 'gemini';
  }
  if (normalized === 'omnivoice') {
    return 'omnivoice';
  }
  return 'elevenlabs';
}

async function probeMediaDurationSeconds(filePath: string): Promise<number> {
  const { spawn } = await import('child_process');

  return new Promise<number>((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exit ${code}: ${stderr.slice(-300)}`));
        return;
      }
      const duration = Number(String(stdout).trim());
      if (!Number.isFinite(duration)) {
        reject(new Error(`ffprobe invalid duration: "${stdout}"`));
        return;
      }
      resolve(duration);
    });
  });
}

async function transcodeAudioFileToMp3(inputPath: string, outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('libmp3lame')
      .format('mp3')
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (error) => reject(error))
      .run();
  });
}

async function concatAudioFilesToMp3(inputPaths: string[], outputPath: string): Promise<void> {
  if (inputPaths.length === 0) {
    throw new Error('Cannot concatenate an empty audio segment list.');
  }

  if (inputPaths.length === 1) {
    await fs.copyFile(inputPaths[0], outputPath);
    return;
  }

  const { spawn } = await import('child_process');
  const inputArgs = inputPaths.flatMap((inputPath) => ['-i', inputPath]);
  const concatInputs = inputPaths.map((_, index) => `[${index}:a]`).join('');
  const args = [
    '-y',
    ...inputArgs,
    '-filter_complex',
    `${concatInputs}concat=n=${inputPaths.length}:v=0:a=1[outa]`,
    '-map',
    '[outa]',
    '-c:a',
    'libmp3lame',
    '-q:a',
    '2',
    outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg concat exit ${code}: ${stderr.slice(-600)}`));
    });
  });
}

async function synthesizeGeminiAudioBySegment(args: {
  jobId: string;
  jobDir: string;
  conversation: PodcastConversationItem[];
  dialogueInputs: Array<{ text: string; voiceId: string }>;
  apiKey: string;
  modelId?: string;
  geminiStyle: GeminiStyle;
  geminiTempo: GeminiTempo;
  speakerVoiceMap: Map<string, string>;
  outputAudioPath: string;
}): Promise<{
  audioBuffer: Buffer;
  voiceSegments: NormalizedVoiceSegment[];
}> {
  const sourceDir = path.join(args.jobDir, 'gemini-source-segments');
  const mp3Dir = path.join(args.jobDir, 'gemini-mp3-segments');
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.mkdir(mp3Dir, { recursive: true });

  let cursor = 0;
  const segmentMp3Paths: string[] = [];
  const voiceSegments: NormalizedVoiceSegment[] = [];

  for (let index = 0; index < args.dialogueInputs.length; index += 1) {
    const input = args.dialogueInputs[index];
    const conversationItem = args.conversation[index];
    const geminiResult = await createGeminiDialogue({
      inputs: [input],
      apiKey: args.apiKey,
      modelId: args.modelId,
      geminiStyle: args.geminiStyle,
      geminiTempo: args.geminiTempo,
    });

    if (!geminiResult.ok) {
      throw new Error(geminiResult.error);
    }

    if (!geminiResult.value.audioBase64) {
      throw new Error(`Gemini TTS did not return audio data for segment ${index + 1}.`);
    }

    const paddedIndex = String(index + 1).padStart(4, '0');
    const wavPath = path.join(sourceDir, `${paddedIndex}.wav`);
    const mp3Path = path.join(mp3Dir, `${paddedIndex}.mp3`);
    await writeBufferFile(wavPath, dataUrlToBuffer(geminiResult.value.audioBase64));
    await transcodeAudioFileToMp3(wavPath, mp3Path);

    const duration = await probeMediaDurationSeconds(mp3Path);
    const startTimeSeconds = cursor;
    const endTimeSeconds = cursor + duration;
    cursor = endTimeSeconds;
    segmentMp3Paths.push(mp3Path);

    voiceSegments.push({
      voiceId: input.voiceId || args.speakerVoiceMap.get('speaker1') || null,
      dialogueInputIndex: index,
      startTimeSeconds,
      endTimeSeconds,
      characterStartIndex: 0,
      characterEndIndex: conversationItem?.text.length || 0,
      speaker: conversationItem?.speaker || `Speaker${index % 2 === 0 ? 1 : 2}`,
    });

    await setPodcastVideoJobStage(
      args.jobId,
      'generating-audio',
      40,
      `Tworze audio z Gemini direct ${index + 1}/${args.dialogueInputs.length}.`
    );
  }

  await concatAudioFilesToMp3(segmentMp3Paths, args.outputAudioPath);
  const finalDuration = await probeMediaDurationSeconds(args.outputAudioPath);
  const lastSegment = voiceSegments.at(-1);
  if (lastSegment) {
    lastSegment.endTimeSeconds = finalDuration;
  }

  return {
    audioBuffer: await fs.readFile(args.outputAudioPath),
    voiceSegments,
  };
}

function buildEstimatedWordsFromSegments(
  segments: NormalizedTranscript['segments']
): NormalizedTranscript['words'] {
  const words: NormalizedTranscript['words'] = [];
  let wordId = 0;

  for (const segment of segments) {
    const rawTokens = segment.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (rawTokens.length === 0) {
      continue;
    }

    const segmentStart = segment.start_time;
    const segmentEnd = Math.max(segmentStart, segment.end_time);
    const totalDuration = Math.max(0.12, segmentEnd - segmentStart);
    const weights = rawTokens.map((token) =>
      Math.max(1, normalizeCaptionToken(token).length || token.length)
    );
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || rawTokens.length;
    let cursor = segmentStart;

    for (let index = 0; index < rawTokens.length; index += 1) {
      const isLast = index === rawTokens.length - 1;
      const sliceDuration = isLast
        ? Math.max(0.04, segmentEnd - cursor)
        : Math.max(0.04, (totalDuration * weights[index]) / totalWeight);
      const startTime = cursor;
      const endTime = isLast ? segmentEnd : Math.min(segmentEnd, cursor + sliceDuration);
      cursor = endTime;

      words.push({
        id: wordId,
        segment_id: segment.id,
        speaker: segment.speaker,
        voice_id: segment.voice_id,
        text: rawTokens[index],
        start_time: roundSeconds(startTime),
        end_time: roundSeconds(Math.max(startTime, endTime)),
      });
      wordId += 1;
    }
  }

  return words;
}

function normalizeVoiceSegmentsForTranscript(
  voiceSegments: PipelineVoiceSegment[],
  conversation: PodcastConversationItem[]
): NormalizedVoiceSegment[] {
  return voiceSegments.map((segment, index) => {
    const dialogueInputIndex = Number(
      segment.dialogue_input_index ?? segment.dialogueInputIndex ?? index
    );
    const conversationItem = conversation[dialogueInputIndex];
    return {
      voiceId: segment.voice_id ?? segment.voiceId ?? null,
      dialogueInputIndex,
      startTimeSeconds: Number(segment.start_time_seconds ?? segment.startTimeSeconds ?? 0),
      endTimeSeconds: Number(segment.end_time_seconds ?? segment.endTimeSeconds ?? 0),
      characterStartIndex: Number(
        segment.character_start_index ?? segment.characterStartIndex ?? 0
      ),
      characterEndIndex: Number(
        segment.character_end_index ??
          segment.characterEndIndex ??
          conversationItem?.text.length ??
          0
      ),
      speaker: String(
        segment.speaker || conversationItem?.speaker || `Speaker${index % 2 === 0 ? 1 : 2}`
      ),
    };
  });
}

function buildEstimatedTranscript(args: {
  source: TtsProvider;
  jobId: string;
  title: string;
  audioFilename: string;
  conversation: PodcastConversationItem[];
  voiceSegments: NormalizedVoiceSegment[];
  speakerVoiceMap: Map<string, string>;
}): NormalizedTranscript {
  const speakers = buildSpeakersMetadata(args.conversation, args.speakerVoiceMap);
  const segments = args.voiceSegments.map((segment, index) => ({
    id: index,
    speaker: segment.speaker || null,
    voice_id: segment.voiceId,
    dialogue_input_index: segment.dialogueInputIndex,
    start_time: roundSeconds(segment.startTimeSeconds),
    end_time: roundSeconds(segment.endTimeSeconds),
    text: args.conversation[segment.dialogueInputIndex]?.text || '',
  }));
  const words = buildEstimatedWordsFromSegments(segments);
  const srt = segments
    .map((segment, index) =>
      `${index + 1}\n${formatSrtTime(segment.start_time)} --> ${formatSrtTime(segment.end_time)}\n${segment.text.toLocaleUpperCase('pl-PL')}\n`
    )
    .join('\n');

  return {
    source: args.source,
    version: 1,
    job_id: args.jobId,
    title: args.title,
    audio_filename: args.audioFilename,
    timestamp: new Date().toISOString(),
    duration_seconds: segments.at(-1)?.end_time || 0,
    full_text: args.conversation.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim(),
    speakers: Object.entries(speakers).map(([id, data]) => ({
      id,
      name: data.name,
      voice_id: data.voiceId,
      gender: data.gender,
      personality: data.personality,
    })),
    segments,
    words,
    srt,
    warnings: words.length > 0 ? ['estimated_word_timing'] : ['estimated_segment_timing'],
  };
}

function getInternalAppBaseUrl(): string {
  return (process.env.INTERNAL_APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3300')
    .trim()
    .replace(/\/+$/, '');
}

function normalizeConversation(conversation: PodcastConversationItem[]): PodcastConversationItem[] {
  return conversation
    .map((item) => ({
      speaker: (item.speaker || '').trim() || 'Speaker1',
      text: (item.text || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((item) => item.text.length > 0);
}

function conversationFromTranscript(transcript: NormalizedTranscript): PodcastConversationItem[] {
  if (!Array.isArray(transcript.segments) || transcript.segments.length === 0) {
    return [];
  }

  return transcript.segments
    .map((segment, index) => ({
      speaker: (segment.speaker || `Speaker${index % 2 === 0 ? 1 : 2}`).trim(),
      text: (segment.text || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((item) => item.text.length > 0);
}

function normalizeSpeakerKey(value: string): string {
  return value.trim().toLowerCase();
}

function buildSpeakerVoiceMap(
  conversation: PodcastConversationItem[],
  voice1: string,
  voice2: string
): Map<string, string> {
  const mapping = new Map<string, string>([
    ['speaker1', voice1],
    ['antoni', voice1],
    ['speaker2', voice2],
    ['zofia', voice2],
  ]);

  const distinctSpeakers: string[] = [];
  for (const item of conversation) {
    const key = normalizeSpeakerKey(item.speaker);
    if (!key) {
      continue;
    }
    if (!distinctSpeakers.includes(key)) {
      distinctSpeakers.push(key);
    }
  }

  distinctSpeakers.forEach((speaker, index) => {
    if (!mapping.has(speaker)) {
      mapping.set(speaker, index === 0 ? voice1 : voice2);
    }
  });

  return mapping;
}

function buildSpeakersMetadata(
  conversation: PodcastConversationItem[],
  speakerVoiceMap: Map<string, string>
) {
  const speakers: Record<string, { name: string; voiceId: string | null; gender: string | null; personality: string | null }> = {};

  for (const item of conversation) {
    const label = item.speaker || 'Speaker1';
    if (speakers[label]) {
      continue;
    }

    const key = normalizeSpeakerKey(label);
    const voiceId = speakerVoiceMap.get(key) || null;
    const isFirstVoice = voiceId === speakerVoiceMap.get('speaker1') || voiceId === speakerVoiceMap.get('antoni');
    speakers[label] = {
      name: label,
      voiceId,
      gender: isFirstVoice ? 'male' : 'female',
      personality: isFirstVoice ? 'Energetic/Naive' : 'Pessimistic/Arrogant',
    };
  }

  return speakers;
}

function buildRawMetadata(args: {
  jobId: string;
  title: string;
  audioFilename: string;
  conversation: PodcastConversationItem[];
  voiceSegments: PipelineVoiceSegment[] | undefined;
  alignment: PipelineAlignment;
  normalizedAlignment: PipelineAlignment;
  speakerVoiceMap: Map<string, string>;
}) {
  const reverseSpeakerMap = new Map<string, string>();
  for (const item of args.conversation) {
    const speakerKey = normalizeSpeakerKey(item.speaker);
    const voiceId = args.speakerVoiceMap.get(speakerKey);
    if (voiceId && !reverseSpeakerMap.has(voiceId)) {
      reverseSpeakerMap.set(voiceId, item.speaker);
    }
  }

  return {
    jobId: args.jobId,
    title: args.title,
    speakers: buildSpeakersMetadata(args.conversation, args.speakerVoiceMap),
    conversation: args.conversation,
    voiceSegments: (args.voiceSegments || []).map((segment) => {
      const voiceId = segment.voice_id || segment.voiceId || null;
      return {
        voiceId,
        dialogueInputIndex: segment.dialogue_input_index ?? segment.dialogueInputIndex,
        startTimeSeconds: segment.start_time_seconds ?? segment.startTimeSeconds,
        endTimeSeconds: segment.end_time_seconds ?? segment.endTimeSeconds,
        characterStartIndex: segment.character_start_index ?? segment.characterStartIndex,
        characterEndIndex: segment.character_end_index ?? segment.characterEndIndex,
        speaker: voiceId ? reverseSpeakerMap.get(voiceId) || 'Speaker1' : 'Speaker1',
      };
    }),
    alignment: args.alignment ? {
      characters: args.alignment.characters,
      characterStartTimesSeconds: args.alignment.character_start_times_seconds ?? args.alignment.characterStartTimesSeconds,
      characterEndTimesSeconds: args.alignment.character_end_times_seconds ?? args.alignment.characterEndTimesSeconds,
    } : args.alignment,
    normalizedAlignment: args.normalizedAlignment ? {
      characters: args.normalizedAlignment.characters,
      characterStartTimesSeconds: args.normalizedAlignment.character_start_times_seconds ?? args.normalizedAlignment.characterStartTimesSeconds,
      characterEndTimesSeconds: args.normalizedAlignment.character_end_times_seconds ?? args.normalizedAlignment.characterEndTimesSeconds,
    } : args.normalizedAlignment,
    audioFilename: args.audioFilename,
    timestamp: new Date().toISOString(),
  };
}

async function generateConversationFromScript(
  scriptText: string,
  title: string,
  language: string,
  ttsProvider: TtsProvider,
  geminiStyle?: GeminiStyle,
  geminiTempo?: GeminiTempo
): Promise<PodcastConversationItem[]> {
  return generateConversationDraft({
    rawText: scriptText,
    title,
    language,
    ttsProvider,
    geminiStyle,
    geminiTempo,
    internalAppBaseUrl: getInternalAppBaseUrl(),
    timeoutMs: 8 * 60 * 1000,
    llmAttemptTimeoutMs: 150 * 1000,
  });
}

function ensureTranscriptCompleteness(
  transcript: NormalizedTranscript,
  title: string,
  audioFilename: string
): NormalizedTranscript {
  const rawSrt = typeof transcript.srt === 'string' ? transcript.srt : '';
  const normalizedSrt =
    rawSrt.includes('\\n') && !rawSrt.includes('\n')
      ? rawSrt
          .replace(/\\r\\n/g, '\n')
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
      : rawSrt;

  return {
    ...transcript,
    source: transcript.source || 'elevenlabs',
    version: transcript.version || 1,
    title: transcript.title || title,
    audio_filename: transcript.audio_filename || audioFilename,
    timestamp: transcript.timestamp || new Date().toISOString(),
    srt: normalizedSrt,
    warnings: Array.isArray(transcript.warnings) ? transcript.warnings : [],
  };
}

async function downloadBufferWithRetry(
  url: string,
  attempts = 5,
  delayMs = 3000
): Promise<Buffer> {
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });

      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
      } else {
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`Could not download artifact from ${url}: ${lastError || 'unknown error'}`);
}

function buildJobConversation(request: PodcastVideoJobRequest): PodcastConversationItem[] {
  if (request.transcript) {
    return conversationFromTranscript(request.transcript);
  }

  if (request.conversation) {
    return normalizeConversation(request.conversation);
  }

  return [];
}

function finalizeTranscript(
  transcript: NormalizedTranscript,
  title: string,
  audioFilename: string
): NormalizedTranscript {
  const completed = ensureTranscriptCompleteness(transcript, title, audioFilename);
  const sanitized = sanitizeTranscriptForCaptions(completed);
  const exactSrt = buildExactSrt(sanitized);

  return {
    ...sanitized,
    srt: exactSrt || sanitized.srt || '',
  };
}

function shouldUseLocalExactRenderer(args: {
  preferExactCaptions: boolean;
  transcript: NormalizedTranscript;
  requestedStyle: string;
}): boolean {
  return (
    args.preferExactCaptions &&
    hasWordTimings(args.transcript) &&
    args.requestedStyle !== 'classic'
  );
}

function resolveLocalFallbackMode(args: {
  transcript: NormalizedTranscript;
  requestedStyle: string;
}): 'highlight_exact' | 'classic_exact' {
  if (hasWordTimings(args.transcript) && args.requestedStyle !== 'classic') {
    return 'highlight_exact';
  }

  return 'classic_exact';
}

async function completeWithLocalRenderer(args: {
  jobId: string;
  transcript: NormalizedTranscript;
  coverPath: string;
  audioPath: string;
  outputPath: string;
  settings: PodcastVideoCaptionSettings;
  fallbackReason?: string | null;
}): Promise<void> {
  const localMode = resolveLocalFallbackMode({
    transcript: args.transcript,
    requestedStyle: args.settings.style,
  });
  const renderMode: PodcastVideoRenderMode =
    localMode === 'highlight_exact' ? 'local_highlight_exact' : 'local_classic_exact';

  await updatePodcastVideoJob(args.jobId, {
    engineUsed: 'local',
    renderMode,
    fallbackReason: args.fallbackReason || null,
  });

  await setPodcastVideoJobStage(
    args.jobId,
    'composing-video',
    72,
    args.fallbackReason
      ? `NCA nie zakonczyl renderu (${args.fallbackReason}). Lokalny renderer przejmuje caly pipeline.`
      : localMode === 'highlight_exact'
        ? 'Lokalny renderer sklada MP4 i przygotowuje exact highlight slowo po slowie.'
        : 'Lokalny renderer sklada MP4 i przygotowuje exact classic z oryginalnego tekstu.'
  );

  await setPodcastVideoJobStage(
    args.jobId,
    'rendering-captions',
    88,
    localMode === 'highlight_exact'
      ? 'Lokalny renderer wypala highlight na podstawie word timings z transcriptu.'
      : 'Lokalny renderer wypala classic 1:1 z oryginalnego tekstu bez auto-transkrypcji.'
  );

  await renderPodcastVideoLocally({
    imagePath: args.coverPath,
    audioPath: args.audioPath,
    outputPath: args.outputPath,
    transcript: args.transcript,
    settings: args.settings,
    mode: localMode,
  });

  await updatePodcastVideoJob(args.jobId, {
    status: 'success',
    stage: 'success',
    progress: 100,
    engineUsed: 'local',
    renderMode,
    fallbackReason: args.fallbackReason || null,
    message:
      localMode === 'highlight_exact'
        ? 'Finalne MP4 jest gotowe. Uzyto lokalnego renderera highlight z tekstem i timingami slow.'
        : 'Finalne MP4 jest gotowe. Uzyto lokalnego renderera classic 1:1, bo transcript nie zawieral timings slowo po slowie.',
    error: null,
  });
}

export async function runPodcastVideoJob(
  jobId: string,
  request: PodcastVideoJobRequest
): Promise<void> {
  const job = await getPodcastVideoJob(jobId);
  if (!job) {
    throw new Error(`Podcast video job missing: ${jobId}`);
  }

  const title = request.title?.trim() || 'Podcast Video';
  const language = request.language?.trim() || 'pl';
  const coverPath = getPodcastVideoCoverPath();
  const preferExactCaptions = request.exact_captions !== false;

  try {
    await ensurePodcastVideoArchiveDir(jobId);
    await setPodcastVideoJobStage(
      jobId,
      'preparing-input',
      10,
      'Sprawdzam wejscie i staly obraz podcastu.'
    );

    if (!(await fileExists(coverPath))) {
      throw new Error(`Podcast cover image was not found: ${coverPath}`);
    }

    const requestedTtsProvider = resolveRequestedTtsProvider(request);
    const geminiStyle = normalizeGeminiStyle(request.tts?.geminiStyle);
    const geminiTempo = normalizeGeminiTempo(request.tts?.geminiTempo);
    let conversation = buildJobConversation(request);
    if (!conversation.length) {
      const scriptText =
        request.raw_text?.replace(/\s+/g, ' ').trim() ||
        request.script_text?.replace(/\s+/g, ' ').trim();
      if (!scriptText) {
        throw new Error('Request must include raw_text, conversation, or transcript.');
      }

      await setPodcastVideoJobStage(
        jobId,
        'generating-conversation',
        22,
        'Generuje conversation z wejscowego tekstu.'
      );
      conversation = await generateConversationFromScript(
        scriptText,
        title,
        language,
        requestedTtsProvider,
        geminiStyle,
        geminiTempo
      );
    }

    if (!conversation.length) {
      throw new Error('Conversation is empty after input normalization.');
    }

    await updatePodcastVideoJob(jobId, {
      inputSummary: {
        hasScriptText: Boolean(request.raw_text?.trim() || request.script_text?.trim()),
        hasConversation: Array.isArray(request.conversation) && request.conversation.length > 0,
        hasTranscript: Boolean(request.transcript),
        conversationCount: conversation.length,
      },
    });

    await setPodcastVideoJobStage(
      jobId,
      'generating-audio',
      40,
      requestedTtsProvider === 'gemini'
        ? 'Tworze audio z Gemini direct.'
        : requestedTtsProvider === 'omnivoice'
          ? 'Tworze audio z OmniVoice.'
          : 'Tworze MP3 i alignment z ElevenLabs.'
    );

    const defaultVoice1 =
      requestedTtsProvider === 'gemini'
        ? DEFAULT_GEMINI_VOICES.voice1
        : DEFAULT_PODCAST_VIDEO_VOICES.voice1;
    const defaultVoice2 =
      requestedTtsProvider === 'gemini'
        ? DEFAULT_GEMINI_VOICES.voice2
        : DEFAULT_PODCAST_VIDEO_VOICES.voice2;
    const voice1 =
      request.tts?.voice1?.trim() ||
      request.voice1?.trim() ||
      defaultVoice1;
    const voice2 =
      request.tts?.voice2?.trim() ||
      request.voice2?.trim() ||
      defaultVoice2;
    const speakerVoiceMap = buildSpeakerVoiceMap(conversation, voice1, voice2);

    const dialogueInputs = conversation.map((item) => ({
      text: item.text,
      voiceId: speakerVoiceMap.get(normalizeSpeakerKey(item.speaker)) || voice2,
    }));

    const paths = await ensurePodcastVideoArchiveDir(jobId);
    const adminSettings = getEffectiveAdminSettings();
    let audioBuffer: Buffer;
    let voiceSegments: PipelineVoiceSegment[] = [];
    let alignment: PipelineAlignment = null;
    let normalizedAlignment: PipelineAlignment = null;

    if (requestedTtsProvider === 'omnivoice') {
      throw new Error(
        'tts.provider "omnivoice" is not supported in /api/podcast-video/jobs. Use /api/podcast-video/podcast-film/jobs instead.'
      );
    }

    if (requestedTtsProvider === 'gemini') {
      const geminiApiKey =
        request.tts?.apiKey?.trim() ||
        String(adminSettings.gemini_api_key || '').trim();

      if (!geminiApiKey) {
        throw new Error('Gemini API key is missing.');
      }

      const geminiAudio = await synthesizeGeminiAudioBySegment({
        jobId,
        jobDir: paths.dir,
        conversation,
        dialogueInputs,
        apiKey: geminiApiKey,
        modelId: request.tts?.model || undefined,
        geminiStyle,
        geminiTempo,
        speakerVoiceMap,
        outputAudioPath: paths.audio,
      });
      audioBuffer = geminiAudio.audioBuffer;
      voiceSegments = geminiAudio.voiceSegments;
    } else {
      const dialogueResult = await createDialogue({
        inputs: dialogueInputs,
        includeTimestamps: true,
        apiKey: request.tts?.apiKey || undefined,
        modelId: request.tts?.model || undefined,
      });

      if (!dialogueResult.ok) {
        throw new Error(dialogueResult.error);
      }

      audioBuffer = dataUrlToBuffer(dialogueResult.value.audioBase64);
      await writeBufferFile(paths.audio, audioBuffer);
      voiceSegments = dialogueResult.value.voiceSegments || [];
      alignment = dialogueResult.value.alignment || null;
      normalizedAlignment = dialogueResult.value.normalizedAlignment || null;
    }
    
    await setPodcastVideoJobStage(
      jobId,
      'generating-audio-stems',
      45,
      requestedTtsProvider === 'elevenlabs'
        ? 'Generuje osobne sciezki audio (stems) na podstawie znacznikow czasu.'
        : 'Generuje stems i segmenty na podstawie szacowanych timingow segmentow.'
    );
    await generateStems(
      paths.audio,
      voiceSegments,
      conversation,
      speakerVoiceMap,
      paths.stem1,
      paths.stem2
    );

    const segmentFiles = await generateIndividualSegments(
      paths.audio,
      voiceSegments,
      conversation,
      speakerVoiceMap,
      paths.segmentsDir
    );

    // Initial update of tracking fields
    await updatePodcastVideoJob(jobId, {
      files: {
        ...job.files,
        segment_paths: segmentFiles.map(f => path.join(paths.segmentsDir, f)),
      },
      artifacts: {
        ...job.artifacts,
        segment_urls: segmentFiles.map(f => buildPodcastVideoFileUrl(job.publicBaseUrl, jobId, 'segment', f)),
      }
    });

    await setPodcastVideoJobStage(
      jobId,
      'building-transcript',
      52,
      'Buduje transcript, JSON i SRT.'
    );

    const transcript = request.transcript
      ? finalizeTranscript(
          request.transcript,
          title,
          path.basename(paths.audio)
        )
      : finalizeTranscript(
          requestedTtsProvider === 'elevenlabs'
            ? parseElevenLabsTranscript(
                buildRawMetadata({
                  jobId,
                  title,
                  audioFilename: path.basename(paths.audio),
                  conversation,
                  voiceSegments,
                  alignment,
                  normalizedAlignment,
                  speakerVoiceMap,
                })
              )
            : buildEstimatedTranscript({
                source: requestedTtsProvider,
                jobId,
                title,
                audioFilename: path.basename(paths.audio),
                conversation,
                voiceSegments: normalizeVoiceSegmentsForTranscript(voiceSegments, conversation),
                speakerVoiceMap,
              }),
          title,
          path.basename(paths.audio)
        );

    await writeJsonFile(paths.transcript, transcript);
    await writeTextFile(paths.srt, transcript.srt || '');

    if (shouldUseLocalExactRenderer({
      preferExactCaptions,
      transcript,
      requestedStyle: job.captionSettings.style,
    })) {
      await completeWithLocalRenderer({
        jobId,
        transcript,
        coverPath,
        audioPath: paths.audio,
        outputPath: paths.mp4,
        settings: job.captionSettings,
      });
      return;
    }

    try {
      await updatePodcastVideoJob(jobId, {
        engineUsed: 'nca',
        renderMode: preferExactCaptions ? 'nca_exact_classic' : 'nca_auto',
        fallbackReason: null,
      });

      await setPodcastVideoJobStage(
        jobId,
        'uploading-assets',
        60,
        'Wysylam audio, cover i napisy do storage dla NCA.'
      );

      const audioUrl = await uploadBufferToMinio(
        audioBuffer,
        `podcast-video/${jobId}/audio.mp3`,
        'audio/mpeg'
      );
      
      // Upload stems
      await uploadFileToMinio(
        paths.stem1,
        `podcast-video/${jobId}/stem_speaker1.mp3`,
        'audio/mpeg'
      );
      await uploadFileToMinio(
        paths.stem2,
        `podcast-video/${jobId}/stem_speaker2.mp3`,
        'audio/mpeg'
      );

      // Upload individual segments
      const segmentFiles = await fs.readdir(paths.segmentsDir).catch(() => []);
      for (const fileName of segmentFiles) {
        if (fileName.endsWith('.mp3')) {
          await uploadFileToMinio(
            path.join(paths.segmentsDir, fileName),
            `podcast-video/${jobId}/segments/${fileName}`,
            'audio/mpeg'
          );
        }
      }
      const imageUrl = await uploadFileToMinio(
        coverPath,
        `podcast-video/${jobId}/podcast_cover.png`,
        'image/png'
      );
      const srtUrl = transcript.srt
        ? await uploadFileToMinio(
            paths.srt,
            `podcast-video/${jobId}/captions.srt`,
            'application/x-subrip'
          )
        : null;

      await setPodcastVideoJobStage(
        jobId,
        'composing-video',
        72,
        'NCA sklada bazowe MP4 z obrazu i audio.'
      );

      const baseVideoUrl = await composePodcastVideo({
        jobId,
        audioUrl,
        imageUrl,
      });

      await setPodcastVideoJobStage(
        jobId,
        'rendering-captions',
        86,
        preferExactCaptions
          ? 'NCA renderuje finalne MP4 z dokladnym SRT opartym o tekst ElevenLabs.'
          : 'NCA renderuje finalne MP4 z auto-transkrypcja napisow.'
      );

      const captionResult = await renderPodcastCaptions({
        jobId,
        videoUrl: baseVideoUrl,
        settings: job.captionSettings,
        srtUrl,
        preferExactText: preferExactCaptions,
      });

      const finalVideoBuffer = await downloadBufferWithRetry(captionResult.url, 8, 4000);
      await writeBufferFile(paths.mp4, finalVideoBuffer);

      await updatePodcastVideoJob(jobId, {
        status: 'success',
        stage: 'success',
        progress: 100,
        engineUsed: 'nca',
        renderMode:
          captionResult.captionSource === 'provided_srt' ? 'nca_exact_classic' : 'nca_auto',
        fallbackReason: null,
        message:
          captionResult.captionSource === 'provided_srt'
            ? `Finalne MP4 jest gotowe. NCA uzyl dokladnego SRT z oryginalnego tekstu ElevenLabs w stylu ${captionResult.effectiveStyle}.`
            : `Finalne MP4 jest gotowe. NCA uzyl auto-transkrypcji w stylu ${captionResult.effectiveStyle}.`,
        error: null,
      });
    } catch (ncaError) {
      const fallbackReason =
        ncaError instanceof Error ? ncaError.message : String(ncaError);

      await completeWithLocalRenderer({
        jobId,
        transcript,
        coverPath,
        audioPath: paths.audio,
        outputPath: paths.mp4,
        settings: job.captionSettings,
        fallbackReason,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failPodcastVideoJob(jobId, 'failed', message, 100);
  }
}
