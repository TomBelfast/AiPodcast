import path from 'path';
import { createDialogue } from '@/actions/dialogue';
import {
  ensurePodcastVideoArchiveDir,
  fileExists,
  writeBufferFile,
  writeJsonFile,
  writeTextFile,
} from '@/lib/podcast-video/archive';
import {
  failPodcastVideoJob,
  getPodcastVideoJob,
  setPodcastVideoJobStage,
  updatePodcastVideoJob,
} from '@/lib/podcast-video/jobs';
import { buildExactSrt, hasWordTimings } from '@/lib/podcast-video/exact-captions';
import { renderPodcastVideoLocally } from '@/lib/podcast-video/local-renderer';
import { uploadBufferToMinio, uploadFileToMinio } from '@/lib/podcast-video/minio';
import { composePodcastVideo, renderPodcastCaptions } from '@/lib/podcast-video/nca';
import {
  DEFAULT_PODCAST_VIDEO_VOICES,
  type PodcastConversationItem,
  type PodcastVideoCaptionSettings,
  type PodcastVideoJobRequest,
  type PodcastVideoRenderMode,
} from '@/lib/podcast-video/types';
import {
  type NormalizedTranscript,
  parseElevenLabsTranscript,
} from '@/lib/transcript-parser';
import { getPodcastVideoCoverPath } from '@/lib/podcast-video/cover';

function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  return Buffer.from(base64, 'base64');
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
  voiceSegments: any[] | undefined;
  alignment: any;
  normalizedAlignment: any;
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
    voiceSegments: (args.voiceSegments || []).map((segment: any) => ({
      ...segment,
      speaker: reverseSpeakerMap.get(segment.voiceId) || 'Speaker1',
    })),
    alignment: args.alignment,
    normalizedAlignment: args.normalizedAlignment,
    audioFilename: args.audioFilename,
    timestamp: new Date().toISOString(),
  };
}

async function parseConversationStream(response: Response): Promise<PodcastConversationItem[]> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Generator conversation stream is unavailable.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finalConversation: PodcastConversationItem[] = [];

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

      const parsed = JSON.parse(trimmed);
      if (parsed.type === 'error') {
        throw new Error(parsed.error || 'Conversation generation failed.');
      }
      if (parsed.type === 'complete') {
        finalConversation = normalizeConversation(parsed.data?.conversation || []);
      }
    }
  }

  if (buffer.trim()) {
    const parsed = JSON.parse(buffer.trim());
    if (parsed.type === 'error') {
      throw new Error(parsed.error || 'Conversation generation failed.');
    }
    if (parsed.type === 'complete') {
      finalConversation = normalizeConversation(parsed.data?.conversation || []);
    }
  }

  return finalConversation;
}

async function generateConversationFromScript(
  scriptText: string,
  title: string,
  language: string
): Promise<PodcastConversationItem[]> {
  const response = await fetch(`${getInternalAppBaseUrl()}/api/generate-podcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: scriptText,
      title,
      language,
    }),
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Conversation generation failed: ${errorText.slice(0, 500)}`);
  }

  return parseConversationStream(response);
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
  const exactSrt = buildExactSrt(completed);

  return {
    ...completed,
    srt: exactSrt || completed.srt || '',
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
      ? 'Lokalny renderer wypala highlight 1:1 na podstawie word timings z ElevenLabs.'
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
        ? 'Finalne MP4 jest gotowe. Uzyto lokalnego renderera highlight 1:1 z tekstem i timingami ElevenLabs.'
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

    let conversation = buildJobConversation(request);
    if (!conversation.length) {
      const scriptText = request.script_text?.replace(/\s+/g, ' ').trim();
      if (!scriptText) {
        throw new Error('Request must include script_text, conversation, or transcript.');
      }

      await setPodcastVideoJobStage(
        jobId,
        'generating-conversation',
        22,
        'Generuje conversation z wejscowego tekstu.'
      );
      conversation = await generateConversationFromScript(scriptText, title, language);
    }

    if (!conversation.length) {
      throw new Error('Conversation is empty after input normalization.');
    }

    await updatePodcastVideoJob(jobId, {
      inputSummary: {
        hasScriptText: Boolean(request.script_text?.trim()),
        hasConversation: Array.isArray(request.conversation) && request.conversation.length > 0,
        hasTranscript: Boolean(request.transcript),
        conversationCount: conversation.length,
      },
    });

    await setPodcastVideoJobStage(
      jobId,
      'generating-audio',
      40,
      'Tworze MP3 i alignment z ElevenLabs.'
    );

    const voice1 = request.voice1?.trim() || DEFAULT_PODCAST_VIDEO_VOICES.voice1;
    const voice2 = request.voice2?.trim() || DEFAULT_PODCAST_VIDEO_VOICES.voice2;
    const speakerVoiceMap = buildSpeakerVoiceMap(conversation, voice1, voice2);

    const dialogueInputs = conversation.map((item) => ({
      text: item.text,
      voiceId: speakerVoiceMap.get(normalizeSpeakerKey(item.speaker)) || voice2,
    }));

    const dialogueResult = await createDialogue({
      inputs: dialogueInputs,
      includeTimestamps: true,
    });

    if (!dialogueResult.ok) {
      throw new Error(dialogueResult.error);
    }

    const paths = await ensurePodcastVideoArchiveDir(jobId);
    const audioBuffer = dataUrlToBuffer(dialogueResult.value.audioBase64);
    await writeBufferFile(paths.audio, audioBuffer);

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
          parseElevenLabsTranscript(
            buildRawMetadata({
              jobId,
              title,
              audioFilename: path.basename(paths.audio),
              conversation,
              voiceSegments: dialogueResult.value.voiceSegments,
              alignment: dialogueResult.value.alignment,
              normalizedAlignment: dialogueResult.value.normalizedAlignment,
              speakerVoiceMap,
            })
          ),
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
