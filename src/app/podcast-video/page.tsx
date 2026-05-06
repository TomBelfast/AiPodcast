'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PodcastStylePreview,
  getSavedGeneratorCoverDefaults,
  type GeneratorCaptionDefaults,
} from '@/components/podcast-video/PodcastStylePreview';
import {
  DEFAULT_ELEVENLABS_VOICES,
  DEFAULT_GEMINI_VOICES,
  type VoiceOption as BaseVoiceOption,
} from '@/lib/voice-catalog';

type PodcastVideoDeckTab = 'generator' | 'style-preview';
type InputMode = 'script' | 'conversation' | 'transcript';
type WorkflowMode = 'workflow-a' | 'workflow-b';
type VideoTtsProvider = 'elevenlabs' | 'gemini' | 'omnivoice';
type ReviewMode = 'off' | 'pause_after_conversation';
type VoiceGenderBucket = 'male' | 'female' | 'unknown';
type GeminiStyle = 'plain' | 'expressive-lite';
type GeminiTempo = 'normal' | 'fast';

type SelectableVoiceOption = {
  id: string;
  name: string;
  provider: VideoTtsProvider;
  category?: string;
  description?: string;
  genderBucket: VoiceGenderBucket;
  style?: string;
  defaultImageFolder?: string;
};

type ClientJob = {
  workflow: WorkflowMode;
  jobId: string;
  title: string;
  language: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  stage: string;
  progress: number;
  message: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  engineUsed: string | null;
  renderMode: string | null;
  fallbackReason: string | null;
  captionSettings: {
    style: string;
    font_size: number;
    line_color: string;
    word_color: string;
    outline_color: string;
  };
  artifacts: {
    json_url: string | null;
    mp3_url: string | null;
    srt_url: string | null;
    mp4_url: string | null;
    stem_speaker1_url: string | null;
    stem_speaker2_url: string | null;
    segment_urls: string[] | null;
  };
  availableArtifacts?: {
    json?: boolean;
    mp3?: boolean;
    srt?: boolean;
    mp4?: boolean;
    stem1?: boolean;
    stem2?: boolean;
  };
  statusUrl: string | null;
  pipeline: string | null;
  ttsProvider: string | null;
  avatarProvider: string | null;
  reviewMode: string | null;
};

const DEFAULT_OMNIVOICE_VOICES = {
  voice1: 'host_a',
  voice2: 'host_b',
} as const;

const DEFAULT_VIDEO_FALLBACK_VOICES: Record<VideoTtsProvider, SelectableVoiceOption[]> = {
  elevenlabs: [
    {
      id: DEFAULT_ELEVENLABS_VOICES.voice1,
      name: 'Ślązak',
      provider: 'elevenlabs',
      category: 'custom',
      genderBucket: 'male',
    },
    {
      id: DEFAULT_ELEVENLABS_VOICES.voice2,
      name: 'Góralka',
      provider: 'elevenlabs',
      category: 'custom',
      genderBucket: 'female',
    },
  ],
  gemini: [
    {
      id: DEFAULT_GEMINI_VOICES.voice1,
      name: 'Charon',
      provider: 'gemini',
      category: 'prebuilt',
      genderBucket: 'male',
      style: 'Informative',
    },
    {
      id: DEFAULT_GEMINI_VOICES.voice2,
      name: 'Kore',
      provider: 'gemini',
      category: 'prebuilt',
      genderBucket: 'female',
      style: 'Firm',
    },
  ],
  omnivoice: [
    {
      id: DEFAULT_OMNIVOICE_VOICES.voice1,
      name: 'Host A',
      provider: 'omnivoice',
      category: 'avatar',
      genderBucket: 'male',
      defaultImageFolder: 'Men',
    },
    {
      id: DEFAULT_OMNIVOICE_VOICES.voice2,
      name: 'Host B',
      provider: 'omnivoice',
      category: 'avatar',
      genderBucket: 'female',
      defaultImageFolder: 'Woman',
    },
  ],
};

const WORKFLOW_STYLE_OPTIONS: Record<WorkflowMode, Array<{ value: string; label: string }>> = {
  'workflow-a': [
    { value: 'highlight', label: 'Highlight' },
    { value: 'classic', label: 'Classic' },
    { value: 'karaoke', label: 'Karaoke' },
    { value: 'word_by_word', label: 'Word by Word' },
    { value: 'underline', label: 'Underline' },
  ],
  'workflow-b': [
    { value: 'highlight', label: 'Highlight' },
    { value: 'classic', label: 'Classic' },
    { value: 'off', label: 'Off' },
  ],
};

const defaultScript = `Napisz krotki podcast o tym, jak AI pomaga porzadkowac prace zespolu i szybciej zamykac zadania.`;

const defaultConversation = JSON.stringify(
  [
    {
      speaker: 'Antoni',
      text: 'Zauważyłem, że dobrze ustawione AI skraca czas pracy przy codziennych zadaniach.',
    },
    {
      speaker: 'Zofia',
      text: 'To prawda, ale tylko wtedy, gdy proces jest dobrze opisany i ktoś pilnuje jakości wyniku.',
    },
  ],
  null,
  2
);

const defaultTranscript = JSON.stringify(
  {
    source: 'elevenlabs',
    version: 1,
    title: 'Przykladowy transcript',
    duration_seconds: 6.2,
    full_text:
      'Zauważyłem, że dobrze ustawione AI skraca czas pracy przy codziennych zadaniach. To prawda, ale tylko wtedy, gdy proces jest dobrze opisany i ktoś pilnuje jakości wyniku.',
    speakers: [
      {
        id: 'Antoni',
        name: 'Antoni',
        voice_id: 'FF7KdobWPaiR0vkcALHF',
        gender: 'male',
        personality: 'Energetic',
      },
      {
        id: 'Zofia',
        name: 'Zofia',
        voice_id: 'BpjGufoPiobT79j2vtj4',
        gender: 'female',
        personality: 'Pessimistic',
      },
    ],
    segments: [
      {
        id: 0,
        speaker: 'Antoni',
        voice_id: 'FF7KdobWPaiR0vkcALHF',
        dialogue_input_index: 0,
        start_time: 0,
        end_time: 2.9,
        text: 'Zauważyłem, że dobrze ustawione AI skraca czas pracy przy codziennych zadaniach.',
      },
      {
        id: 1,
        speaker: 'Zofia',
        voice_id: 'BpjGufoPiobT79j2vtj4',
        dialogue_input_index: 1,
        start_time: 2.9,
        end_time: 6.2,
        text: 'To prawda, ale tylko wtedy, gdy proces jest dobrze opisany i ktoś pilnuje jakości wyniku.',
      },
    ],
    words: [],
    srt:
      '1\\n00:00:00,000 --> 00:00:02,900\\nAntoni: Zauważyłem, że dobrze ustawione AI skraca czas pracy przy codziennych zadaniach.\\n\\n2\\n00:00:02,900 --> 00:00:06,200\\nZofia: To prawda, ale tylko wtedy, gdy proces jest dobrze opisany i ktoś pilnuje jakości wyniku.\\n',
    warnings: [],
  },
  null,
  2
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeGenderBucket(value: string | undefined): VoiceGenderBucket {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'male' || normalized === 'm') return 'male';
  if (normalized === 'female' || normalized === 'f') return 'female';
  return 'unknown';
}

function getDefaultVoicesForProvider(provider: VideoTtsProvider) {
  if (provider === 'gemini') {
    return DEFAULT_GEMINI_VOICES;
  }
  if (provider === 'omnivoice') {
    return DEFAULT_OMNIVOICE_VOICES;
  }
  return DEFAULT_ELEVENLABS_VOICES;
}

function emptyArtifacts() {
  return {
    json_url: null,
    mp3_url: null,
    srt_url: null,
    mp4_url: null,
    stem_speaker1_url: null,
    stem_speaker2_url: null,
    segment_urls: null,
  };
}

function emptyAvailableArtifacts() {
  return {
    json: false,
    mp3: false,
    srt: false,
    mp4: false,
    stem1: false,
    stem2: false,
  };
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toWorkflowStatus(
  state: string | null
): ClientJob['status'] {
  if (state === 'done') return 'success';
  if (state === 'failed') return 'failed';
  if (state === 'queued') return 'queued';
  return 'running';
}

function workflowLabel(workflow: WorkflowMode): string {
  return workflow === 'workflow-a' ? 'Workflow A' : 'Workflow B';
}

function workflowShortLabel(workflow: WorkflowMode): string {
  return workflow === 'workflow-a' ? 'Cover Video' : 'Avatar Video';
}

function inputModeLabel(mode: InputMode): string {
  if (mode === 'script') return 'Raw Text';
  if (mode === 'conversation') return 'Conversation';
  return 'Transcript';
}

function inputModeDescription(mode: InputMode): string {
  if (mode === 'script') {
    return 'System wygeneruje rozmowę przez OpenRouter, a potem przejdzie do TTS i renderu.';
  }
  if (mode === 'conversation') {
    return 'Pomijamy LLM i używamy gotowej rozmowy bezpośrednio do syntezy i video.';
  }
  return 'Legacy transcript tylko dla workflow A.';
}

function providerLabel(provider: string | null): string {
  if (provider === 'gemini') return 'Gemini';
  if (provider === 'elevenlabs') return 'ElevenLabs';
  if (provider === 'omnivoice') return 'OmniVoice';
  return 'pending';
}

function renderLabel(workflow: WorkflowMode): string {
  return workflow === 'workflow-a' ? 'Cover + captions renderer' : 'SoulX avatar renderer';
}

function buildCaptionSettings(args: {
  style: string;
  fontSize: string;
  lineColor: string;
  wordColor: string;
  outlineColor: string;
}) {
  return {
    style: args.style,
    font_size: Number(args.fontSize),
    line_color: args.lineColor,
    word_color: args.wordColor,
    outline_color: args.outlineColor,
  };
}

function normalizeWorkflowAJob(
  job: Record<string, unknown>,
  statusUrl: string | null,
  previous: ClientJob | null,
  provider: VideoTtsProvider
): ClientJob {
  const artifacts = isRecord(job.artifacts) ? job.artifacts : {};
  const availableArtifacts = isRecord(job.availableArtifacts) ? job.availableArtifacts : {};
  const captionSettings = isRecord(job.captionSettings) ? job.captionSettings : {};

  return {
    workflow: 'workflow-a',
    jobId: readString(job, 'jobId') || previous?.jobId || 'pending',
    title: readString(job, 'title') || previous?.title || 'Podcast Video',
    language: readString(job, 'language') || previous?.language || 'pl',
    status:
      (readString(job, 'status') as ClientJob['status'] | null) ||
      previous?.status ||
      'queued',
    stage: readString(job, 'stage') || previous?.stage || 'queued',
    progress: readNumber(job, 'progress') ?? previous?.progress ?? 0,
    message: readString(job, 'message') || previous?.message || 'Job accepted.',
    error: readString(job, 'error') || previous?.error || null,
    createdAt: readString(job, 'createdAt') || previous?.createdAt || new Date().toISOString(),
    updatedAt: readString(job, 'updatedAt') || previous?.updatedAt || new Date().toISOString(),
    completedAt: readString(job, 'completedAt') || previous?.completedAt || null,
    engineUsed: readString(job, 'engineUsed') || previous?.engineUsed || null,
    renderMode: readString(job, 'renderMode') || previous?.renderMode || null,
    fallbackReason: readString(job, 'fallbackReason') || previous?.fallbackReason || null,
    captionSettings: {
      style: readString(captionSettings, 'style') || previous?.captionSettings.style || 'highlight',
      font_size: readNumber(captionSettings, 'font_size') ?? previous?.captionSettings.font_size ?? 86,
      line_color:
        readString(captionSettings, 'line_color') ||
        previous?.captionSettings.line_color ||
        '#FFFFFF',
      word_color:
        readString(captionSettings, 'word_color') ||
        previous?.captionSettings.word_color ||
        '#00FF04',
      outline_color:
        readString(captionSettings, 'outline_color') ||
        previous?.captionSettings.outline_color ||
        '#000000',
    },
    artifacts: {
      json_url: readString(artifacts, 'json_url') || previous?.artifacts.json_url || null,
      mp3_url: readString(artifacts, 'mp3_url') || previous?.artifacts.mp3_url || null,
      srt_url: readString(artifacts, 'srt_url') || previous?.artifacts.srt_url || null,
      mp4_url: readString(artifacts, 'mp4_url') || previous?.artifacts.mp4_url || null,
      stem_speaker1_url:
        readString(artifacts, 'stem_speaker1_url') || previous?.artifacts.stem_speaker1_url || null,
      stem_speaker2_url:
        readString(artifacts, 'stem_speaker2_url') || previous?.artifacts.stem_speaker2_url || null,
      segment_urls:
        Array.isArray(artifacts.segment_urls) && artifacts.segment_urls.every((item) => typeof item === 'string')
          ? (artifacts.segment_urls as string[])
          : previous?.artifacts.segment_urls || null,
    },
    availableArtifacts: {
      json: Boolean(availableArtifacts.json),
      mp3: Boolean(availableArtifacts.mp3),
      srt: Boolean(availableArtifacts.srt),
      mp4: Boolean(availableArtifacts.mp4),
      stem1: Boolean(availableArtifacts.stem1),
      stem2: Boolean(availableArtifacts.stem2),
    },
    statusUrl,
    pipeline: 'podcast-video-v1',
    ttsProvider: previous?.ttsProvider || provider,
    avatarProvider: previous?.avatarProvider || 'soulx',
    reviewMode: previous?.reviewMode || 'off',
  };
}

function createWorkflowBQueuedJob(args: {
  jobId: string;
  statusUrl: string;
  title: string;
  language: string;
  provider: VideoTtsProvider;
  reviewMode: ReviewMode;
  captionSettings: ClientJob['captionSettings'];
}): ClientJob {
  return {
    workflow: 'workflow-b',
    jobId: args.jobId,
    title: args.title,
    language: args.language,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    message: 'Job został przyjęty i czeka na kolejne etapy pipeline’u.',
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    engineUsed: 'soulx',
    renderMode: 'avatar_concat',
    fallbackReason: null,
    captionSettings: args.captionSettings,
    artifacts: emptyArtifacts(),
    availableArtifacts: emptyAvailableArtifacts(),
    statusUrl: args.statusUrl,
    pipeline: 'podcast-film-v1',
    ttsProvider: args.provider,
    avatarProvider: 'soulx',
    reviewMode: args.reviewMode,
  };
}

function normalizeWorkflowBStatus(
  payload: Record<string, unknown>,
  previous: ClientJob
): ClientJob {
  const result = isRecord(payload.result) ? payload.result : {};
  const state = readString(payload, 'state');
  const phase = readString(payload, 'phase');
  const success = payload.success;
  const topLevelTtsProvider =
    readString(payload, 'tts_engine') ||
    readString(result, 'tts_engine') ||
    previous.ttsProvider;
  const mp4Url =
    readString(payload, 'mp4_url') ||
    readString(result, 'mp4_url') ||
    previous.artifacts.mp4_url;
  const srtUrl =
    readString(payload, 'srt_url') ||
    readString(result, 'srt_url') ||
    previous.artifacts.srt_url;
  const detail =
    readString(payload, 'detail') ||
    (isRecord(payload.error) ? readString(payload.error, 'detail') : null) ||
    previous.error;

  return {
    ...previous,
    status:
      success === false
        ? 'failed'
        : toWorkflowStatus(state),
    stage: phase || previous.stage,
    progress: readNumber(payload, 'percent') ?? previous.progress,
    message: readString(payload, 'message') || previous.message,
    error: detail,
    updatedAt: readString(payload, 'updated_at') || previous.updatedAt,
    completedAt:
      state === 'done' || state === 'failed'
        ? readString(payload, 'updated_at') || previous.completedAt || new Date().toISOString()
        : previous.completedAt,
    artifacts: {
      ...previous.artifacts,
      mp4_url: mp4Url,
      srt_url: srtUrl,
    },
    availableArtifacts: {
      ...previous.availableArtifacts,
      mp4: Boolean(mp4Url),
      srt: Boolean(srtUrl),
    },
    ttsProvider: topLevelTtsProvider,
    pipeline: readString(result, 'pipeline') || previous.pipeline,
  };
}

function mapElevenLabsOrGeminiVoices(
  provider: Exclude<VideoTtsProvider, 'omnivoice'>,
  voices: BaseVoiceOption[]
): SelectableVoiceOption[] {
  return voices.map((voice) => ({
    id: voice.id,
    name: voice.name,
    provider,
    category: voice.category,
    description: voice.description,
    genderBucket: voice.genderBucket,
    style: voice.style,
  }));
}

function mapOmniVoiceVoices(payload: Record<string, unknown>): SelectableVoiceOption[] {
  const voices = Array.isArray(payload.voices) ? payload.voices : [];
  return voices
    .filter((voice): voice is Record<string, unknown> => isRecord(voice))
    .map((voice) => ({
      id: readString(voice, 'id') || '',
      name: readString(voice, 'label') || readString(voice, 'id') || 'Voice',
      provider: 'omnivoice' as const,
      category: readString(voice, 'language') || 'avatar',
      description: Array.isArray(voice.aliases)
        ? (voice.aliases.filter((item): item is string => typeof item === 'string').slice(0, 3).join(', ') || undefined)
        : undefined,
      genderBucket: normalizeGenderBucket(readString(voice, 'gender') || undefined),
      defaultImageFolder: readString(voice, 'default_image_folder') || undefined,
    }))
    .filter((voice) => Boolean(voice.id));
}

function buildArtifactItems(job: ClientJob | null) {
  if (!job) {
    return [];
  }

  const items = [
    {
      key: 'json',
      label: 'JSON TRANSCRIPT',
      url: job.artifacts.json_url,
      ready: Boolean(job.availableArtifacts?.json),
      emphasized: false,
    },
    {
      key: 'mp3',
      label: 'AUDIO MP3',
      url: job.artifacts.mp3_url,
      ready: Boolean(job.availableArtifacts?.mp3),
      emphasized: false,
    },
    {
      key: 'srt',
      label: 'CAPTIONS SRT',
      url: job.artifacts.srt_url,
      ready: Boolean(job.availableArtifacts?.srt),
      emphasized: false,
    },
    {
      key: 'mp4',
      label: 'FINAL MP4',
      url: job.artifacts.mp4_url,
      ready: Boolean(job.availableArtifacts?.mp4),
      emphasized: true,
    },
  ];

  return items.filter((item) => {
    if (job.workflow === 'workflow-a') {
      return true;
    }
    return item.key === 'srt' || item.key === 'mp4';
  });
}

function normalizePersistedJob(job: Record<string, unknown>): ClientJob | null {
  const workflow = readString(job, 'workflow');
  if (workflow !== 'workflow-a' && workflow !== 'workflow-b') {
    return null;
  }

  const artifacts = isRecord(job.artifacts) ? job.artifacts : {};
  const availableArtifacts = isRecord(job.availableArtifacts) ? job.availableArtifacts : {};
  const captionSettings = isRecord(job.captionSettings) ? job.captionSettings : {};

  return {
    workflow,
    jobId: readString(job, 'jobId') || 'unknown',
    title: readString(job, 'title') || 'Podcast Video',
    language: readString(job, 'language') || 'pl',
    status: (readString(job, 'status') as ClientJob['status'] | null) || 'queued',
    stage: readString(job, 'stage') || 'queued',
    progress: readNumber(job, 'progress') ?? 0,
    message: readString(job, 'message') || 'Job archived.',
    error: readString(job, 'error') || null,
    createdAt: readString(job, 'createdAt') || new Date().toISOString(),
    updatedAt: readString(job, 'updatedAt') || new Date().toISOString(),
    completedAt: readString(job, 'completedAt') || null,
    engineUsed: readString(job, 'engineUsed') || null,
    renderMode: readString(job, 'renderMode') || null,
    fallbackReason: readString(job, 'fallbackReason') || null,
    captionSettings: {
      style: readString(captionSettings, 'style') || 'highlight',
      font_size: readNumber(captionSettings, 'font_size') ?? 86,
      line_color: readString(captionSettings, 'line_color') || '#FFFFFF',
      word_color: readString(captionSettings, 'word_color') || '#00FF04',
      outline_color: readString(captionSettings, 'outline_color') || '#000000',
    },
    artifacts: {
      json_url: readString(artifacts, 'json_url'),
      mp3_url: readString(artifacts, 'mp3_url'),
      srt_url: readString(artifacts, 'srt_url'),
      mp4_url: readString(artifacts, 'mp4_url'),
      stem_speaker1_url: readString(artifacts, 'stem_speaker1_url'),
      stem_speaker2_url: readString(artifacts, 'stem_speaker2_url'),
      segment_urls:
        Array.isArray(artifacts.segment_urls) && artifacts.segment_urls.every((item) => typeof item === 'string')
          ? (artifacts.segment_urls as string[])
          : null,
    },
    availableArtifacts: {
      json: Boolean(availableArtifacts.json),
      mp3: Boolean(availableArtifacts.mp3),
      srt: Boolean(availableArtifacts.srt),
      mp4: Boolean(availableArtifacts.mp4),
      stem1: Boolean(availableArtifacts.stem1),
      stem2: Boolean(availableArtifacts.stem2),
    },
    statusUrl: readString(job, 'statusUrl'),
    pipeline: readString(job, 'pipeline'),
    ttsProvider: readString(job, 'ttsProvider'),
    avatarProvider: readString(job, 'avatarProvider'),
    reviewMode: readString(job, 'reviewMode'),
  };
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return 'brak daty';
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(parsed));
}

export default function PodcastVideoPage() {
  const [deckTab, setDeckTab] = useState<PodcastVideoDeckTab>('generator');
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('workflow-a');
  const [inputMode, setInputMode] = useState<InputMode>('script');
  const [title, setTitle] = useState('Podcast Video Test');
  const [language, setLanguage] = useState('pl');
  const [payloadText, setPayloadText] = useState(defaultScript);
  const [ttsProvider, setTtsProvider] = useState<VideoTtsProvider>('gemini');
  const [availableVoices, setAvailableVoices] = useState<SelectableVoiceOption[]>([]);
  const [selectedVoice1, setSelectedVoice1] = useState<string>(DEFAULT_GEMINI_VOICES.voice1);
  const [selectedVoice2, setSelectedVoice2] = useState<string>(DEFAULT_GEMINI_VOICES.voice2);
  const [geminiStyle, setGeminiStyle] = useState<GeminiStyle>('expressive-lite');
  const [geminiTempo, setGeminiTempo] = useState<GeminiTempo>('fast');
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [reviewMode, setReviewMode] = useState<ReviewMode>('off');
  const [style, setStyle] = useState('highlight');
  const [exactCaptions, setExactCaptions] = useState(true);
  const [fontSize, setFontSize] = useState('86');
  const [lineColor, setLineColor] = useState('#FFFFFF');
  const [wordColor, setWordColor] = useState('#00FF04');
  const [outlineColor, setOutlineColor] = useState('#000000');
  const [activeJob, setActiveJob] = useState<ClientJob | null>(null);
  const [jobHistory, setJobHistory] = useState<ClientJob[]>([]);
  const [selectedPreviewJobId, setSelectedPreviewJobId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [armedDeleteJobId, setArmedDeleteJobId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [coverVersion, setCoverVersion] = useState(() => Date.now());
  const [selectedCoverFile, setSelectedCoverFile] = useState<File | null>(null);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [coverMessage, setCoverMessage] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [voiceSampleLoadingId, setVoiceSampleLoadingId] = useState<string | null>(null);
  const [voiceSamplePlayingId, setVoiceSamplePlayingId] = useState<string | null>(null);
  const [voiceSampleError, setVoiceSampleError] = useState<string | null>(null);
  const [voiceSampleNotice, setVoiceSampleNotice] = useState<string | null>(null);
  const [voiceSampleAudioSrc, setVoiceSampleAudioSrc] = useState<string | null>(null);
  const [voiceSampleAudioLabel, setVoiceSampleAudioLabel] = useState<string | null>(null);
  const [voiceSampleAudioVoiceId, setVoiceSampleAudioVoiceId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const statusSectionRef = useRef<HTMLElement>(null);
  const previewSectionRef = useRef<HTMLElement>(null);
  const voiceSampleAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastScrolledJobRef = useRef<string | null>(null);
  const lastPreviewJobRef = useRef<string | null>(null);
  const lastHistoryRefreshJobRef = useRef<string | null>(null);

  const placeholder = useMemo(() => {
    if (inputMode === 'conversation') return defaultConversation;
    if (inputMode === 'transcript') return defaultTranscript;
    return defaultScript;
  }, [inputMode]);

  const coverUrl = useMemo(
    () => `/api/podcast-video/cover?v=${coverVersion}`,
    [coverVersion]
  );

  const availableProviders = useMemo(
    () =>
      workflowMode === 'workflow-b'
        ? (['gemini', 'elevenlabs', 'omnivoice'] as VideoTtsProvider[])
        : (['gemini', 'elevenlabs'] as VideoTtsProvider[]),
    [workflowMode]
  );

  const styleOptions = WORKFLOW_STYLE_OPTIONS[workflowMode];

  const groupedVoices = useMemo(
    () => ({
      male: availableVoices.filter((voice) => voice.genderBucket === 'male'),
      female: availableVoices.filter((voice) => voice.genderBucket === 'female'),
      unknown: availableVoices.filter((voice) => voice.genderBucket === 'unknown'),
    }),
    [availableVoices]
  );

  const previewJob = useMemo(() => {
    if (selectedPreviewJobId) {
      const selected = jobHistory.find((job) => job.jobId === selectedPreviewJobId);
      if (selected) {
        return selected;
      }
    }

    if (activeJob?.status === 'success' && activeJob.artifacts.mp4_url) {
      return activeJob;
    }

    return jobHistory[0] || null;
  }, [activeJob, jobHistory, selectedPreviewJobId]);

  const detailsJob = activeJob || previewJob;
  const previewMatchesActiveJob = Boolean(
    activeJob && previewJob && activeJob.jobId === previewJob.jobId
  );
  const previewArchiveNotice =
    activeJob && previewJob && activeJob.jobId !== previewJob.jobId
      ? activeJob.status === 'failed'
        ? `Aktualny job ${activeJob.jobId} zakonczyl sie bledem i nie wygenerowal nowego MP4. Ponizej widzisz poprzedni zapisany film ${previewJob.jobId}.`
        : activeJob.status === 'success'
          ? `Ponizej widzisz zapisany film z aktualnego joba ${activeJob.jobId}.`
          : `Aktualny job ${activeJob.jobId} jeszcze nie wygenerowal MP4. Ponizej widzisz poprzedni zapisany film ${previewJob.jobId}.`
      : null;
  const artifactItems = useMemo(() => buildArtifactItems(detailsJob), [detailsJob]);
  const trimmedPayload = payloadText.trim();
  const isReadyToGenerate = Boolean(
    title.trim() &&
      language.trim() &&
      trimmedPayload &&
      selectedVoice1.trim() &&
      selectedVoice2.trim()
  );
  const flowSummary = useMemo(() => {
    const inputStage = inputMode === 'script' ? 'Raw Text' : inputMode === 'conversation' ? 'Conversation' : 'Transcript';
    const llmStage = inputMode === 'script' ? 'OpenRouter' : 'Direct';
    const ttsStage = providerLabel(ttsProvider);
    const renderStage = workflowMode === 'workflow-a' ? 'Cover Render' : 'SoulX';
    return [inputStage, llmStage, ttsStage, renderStage, 'MP4'].join(' -> ');
  }, [inputMode, ttsProvider, workflowMode]);
  const wizardSteps = useMemo(
    () => [
      {
        number: '01',
        title: 'Wejście',
        value: inputModeLabel(inputMode),
        description: inputModeDescription(inputMode),
        done: Boolean(trimmedPayload),
      },
      {
        number: '02',
        title: 'Workflow',
        value: workflowShortLabel(workflowMode),
        description:
          workflowMode === 'workflow-a'
            ? 'Klasyczny cover-video z artefaktami audio i captions.'
            : 'Avatar-video z pipelinem SoulX i finalnym concatem.',
        done: true,
      },
      {
        number: '03',
        title: 'Głosy',
        value: `${providerLabel(ttsProvider)} / ${selectedVoice1} + ${selectedVoice2}`,
        description: isLoadingVoices
          ? 'Ładowanie katalogu głosów.'
          : 'Dobór TTS i dwóch hostów dla finalnego dialogu.',
        done: Boolean(selectedVoice1 && selectedVoice2),
      },
      {
        number: '04',
        title: 'Render',
        value: renderLabel(workflowMode),
        description:
          inputMode === 'script' && reviewMode === 'pause_after_conversation'
            ? 'Pipeline zatrzyma się po wygenerowaniu conversation draft.'
            : 'Pipeline poleci end-to-end bez zatrzymania.',
        done: true,
      },
      {
        number: '05',
        title: 'Generuj',
        value: isSubmitting ? 'Uruchamianie' : 'Gotowe do startu',
        description: flowSummary,
        done: isReadyToGenerate,
      },
    ],
    [
      flowSummary,
      inputMode,
      isLoadingVoices,
      isReadyToGenerate,
      isSubmitting,
      reviewMode,
      selectedVoice1,
      selectedVoice2,
      trimmedPayload,
      ttsProvider,
      workflowMode,
    ]
  );

  const loadHistory = useCallback(
    async (preferredJobId?: string | null) => {
      setIsLoadingHistory(true);
      try {
        const response = await fetch('/api/podcast-video/jobs?limit=30', {
          cache: 'no-store',
        });
        const data = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
          throw new Error(readString(data, 'error') || 'Failed to load podcast video history.');
        }

        const nextHistory = Array.isArray(data.jobs)
          ? data.jobs
              .filter((item): item is Record<string, unknown> => isRecord(item))
              .map((item) => normalizePersistedJob(item))
              .filter((item): item is ClientJob => Boolean(item))
          : [];

        setJobHistory(nextHistory);
        setHistoryError(null);
        setSelectedPreviewJobId((current) => {
          if (preferredJobId && nextHistory.some((job) => job.jobId === preferredJobId)) {
            return preferredJobId;
          }
          if (current && nextHistory.some((job) => job.jobId === current)) {
            return current;
          }
          return nextHistory[0]?.jobId || null;
        });
        setActiveJob((current) => {
          if (!current) {
            return null;
          }
          const replacement = nextHistory.find((job) => job.jobId === current.jobId);
          if (replacement) {
            return replacement;
          }
          if (current.status === 'queued' || current.status === 'running') {
            return current;
          }
          return null;
        });
      } catch (historyLoadError) {
        setHistoryError(
          historyLoadError instanceof Error
            ? historyLoadError.message
            : 'Failed to load podcast video history.'
        );
      } finally {
        setIsLoadingHistory(false);
      }
    },
    []
  );

  useEffect(() => {
    if (workflowMode === 'workflow-b' && inputMode === 'transcript') {
      setInputMode('script');
      setPayloadText(defaultScript);
      setNotice('Workflow B obsługuje publicznie tylko TEKST albo CONVO, więc wyłączyłem tryb transcript.');
    }
  }, [workflowMode, inputMode]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!availableProviders.includes(ttsProvider)) {
      setTtsProvider(workflowMode === 'workflow-b' ? 'gemini' : 'gemini');
    }
  }, [availableProviders, ttsProvider, workflowMode]);

  useEffect(() => {
    if (!styleOptions.some((option) => option.value === style)) {
      setStyle('highlight');
    }
  }, [style, styleOptions]);

  useEffect(() => {
    if (inputMode === 'script') {
      setPayloadText(defaultScript);
    } else if (inputMode === 'conversation') {
      setPayloadText(defaultConversation);
    } else {
      setPayloadText(defaultTranscript);
    }
  }, [inputMode]);

  useEffect(() => {
    let cancelled = false;

    async function fetchVoices() {
      setIsLoadingVoices(true);
      try {
        const response =
          ttsProvider === 'omnivoice'
            ? await fetch('/api/podcast-video/podcast-film/voices', { cache: 'no-store' })
            : await fetch(`/api/voices?provider=${ttsProvider}`, { cache: 'no-store' });

        if (!response.ok) {
          throw new Error(`Voice catalogue request failed with ${response.status}`);
        }

        const payload = (await response.json()) as Record<string, unknown>;
        const loadedVoices =
          ttsProvider === 'omnivoice'
            ? mapOmniVoiceVoices(payload)
            : mapElevenLabsOrGeminiVoices(
                ttsProvider as Exclude<VideoTtsProvider, 'omnivoice'>,
                Array.isArray(payload.voices) ? (payload.voices as BaseVoiceOption[]) : []
              );

        if (cancelled) {
          return;
        }

        const defaults = getDefaultVoicesForProvider(ttsProvider);
        const fallback = DEFAULT_VIDEO_FALLBACK_VOICES[ttsProvider];
        const safeVoices = loadedVoices.length > 0 ? loadedVoices : fallback;

        setAvailableVoices(safeVoices);
        setSelectedVoice1((current) =>
          safeVoices.some((voice) => voice.id === current)
            ? current
            : safeVoices.find((voice) => voice.genderBucket === 'male')?.id ||
              safeVoices[0]?.id ||
              defaults.voice1
        );
        setSelectedVoice2((current) =>
          safeVoices.some((voice) => voice.id === current)
            ? current
            : safeVoices.find((voice) => voice.genderBucket === 'female')?.id ||
              safeVoices[1]?.id ||
              safeVoices[0]?.id ||
              defaults.voice2
        );
      } catch (voiceError) {
        if (cancelled) {
          return;
        }

        const fallback = DEFAULT_VIDEO_FALLBACK_VOICES[ttsProvider];
        const defaults = getDefaultVoicesForProvider(ttsProvider);
        console.error('Failed to fetch video voices:', voiceError);
        setAvailableVoices(fallback);
        setSelectedVoice1(defaults.voice1);
        setSelectedVoice2(defaults.voice2);
      } finally {
        if (!cancelled) {
          setIsLoadingVoices(false);
        }
      }
    }

    void fetchVoices();

    return () => {
      cancelled = true;
    };
  }, [ttsProvider]);

  useEffect(() => {
    if (!activeJob?.statusUrl || activeJob.status === 'success' || activeJob.status === 'failed') {
      return;
    }

    const refreshStatus = async () => {
      try {
        const response = await fetch(activeJob.statusUrl!, {
          cache: 'no-store',
        });
        const data = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
          throw new Error(readString(data, 'error') || 'Failed to refresh job status.');
        }

        setActiveJob((previous) => {
          if (!previous) {
            return previous;
          }

          if (previous.workflow === 'workflow-a') {
            return isRecord(data.job)
              ? normalizeWorkflowAJob(data.job, readString(data, 'statusUrl') || previous.statusUrl, previous, previous.ttsProvider as VideoTtsProvider)
              : previous;
          }

          return normalizeWorkflowBStatus(data, previous);
        });
      } catch (pollError) {
        setError(
          pollError instanceof Error ? pollError.message : 'Failed to refresh podcast video job.'
        );
      }
    };

    void refreshStatus();
    const interval = window.setInterval(refreshStatus, 3000);

    return () => window.clearInterval(interval);
  }, [activeJob?.jobId, activeJob?.status, activeJob?.statusUrl, activeJob?.workflow]);

  useEffect(() => {
    voiceSampleAudioRef.current?.pause();
    setVoiceSamplePlayingId(null);
    setVoiceSampleError(null);
    setVoiceSampleNotice(null);
    setVoiceSampleAudioSrc(null);
    setVoiceSampleAudioLabel(null);
    setVoiceSampleAudioVoiceId(null);
  }, [ttsProvider, language, geminiStyle, geminiTempo]);

  useEffect(() => {
    if (!voiceSampleAudioSrc || !voiceSampleAudioRef.current) {
      return;
    }

    const audio = voiceSampleAudioRef.current;
    audio.currentTime = 0;
    void audio.play().catch(() => {
      setVoiceSampleNotice('Próbka jest gotowa. Jeśli nie ruszy automatycznie, kliknij Play w odtwarzaczu.');
    });
  }, [voiceSampleAudioSrc]);

  useEffect(() => {
    if (!activeJob?.jobId || lastScrolledJobRef.current === activeJob.jobId) {
      return;
    }

    lastScrolledJobRef.current = activeJob.jobId;
    statusSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [activeJob?.jobId]);

  useEffect(() => {
    if (
      activeJob?.status !== 'success' ||
      !activeJob.artifacts.mp4_url ||
      lastPreviewJobRef.current === activeJob.jobId
    ) {
      return;
    }

    lastPreviewJobRef.current = activeJob.jobId;
    previewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [activeJob?.artifacts.mp4_url, activeJob?.jobId, activeJob?.status]);

  useEffect(() => {
    if (activeJob?.status !== 'success' || !activeJob.jobId) {
      return;
    }
    if (lastHistoryRefreshJobRef.current === activeJob.jobId) {
      return;
    }

    lastHistoryRefreshJobRef.current = activeJob.jobId;
    void loadHistory(activeJob.jobId);
  }, [activeJob?.jobId, activeJob?.status, loadHistory]);

  async function handlePreviewGeminiVoice(voiceId: string) {
    if (ttsProvider !== 'gemini' || !voiceId) {
      return;
    }

    if (voiceSamplePlayingId === voiceId && voiceSampleAudioRef.current) {
      voiceSampleAudioRef.current.pause();
      voiceSampleAudioRef.current.currentTime = 0;
      setVoiceSamplePlayingId(null);
      return;
    }

    setVoiceSampleError(null);
    setVoiceSampleNotice(null);
    setVoiceSampleLoadingId(voiceId);

    try {
      const response = await fetch('/api/voices/gemini/sample', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          voiceId,
          language,
          geminiStyle,
          geminiTempo,
        }),
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(readString(data, 'error') || 'Nie udało się wygenerować próbki Gemini.');
      }

      const audioBase64 = readString(data, 'audioBase64');
      if (!audioBase64) {
        throw new Error('Endpoint próbki Gemini nie zwrócił audio.');
      }

      voiceSampleAudioRef.current?.pause();
      setVoiceSampleAudioSrc(audioBase64);
      setVoiceSampleAudioLabel(
        availableVoices.find((voice) => voice.id === voiceId)?.name || voiceId
      );
      setVoiceSampleAudioVoiceId(voiceId);
      setVoiceSamplePlayingId(voiceId);
    } catch (sampleError) {
      setVoiceSamplePlayingId(null);
      setVoiceSampleAudioSrc(null);
      setVoiceSampleAudioLabel(null);
      setVoiceSampleAudioVoiceId(null);
      setVoiceSampleError(
        sampleError instanceof Error ? sampleError.message : 'Nie udało się odtworzyć próbki Gemini.'
      );
    } finally {
      setVoiceSampleLoadingId((current) => (current === voiceId ? null : current));
    }
  }

  function renderGeminiSampleButton(voiceId: string, label: string) {
    if (ttsProvider !== 'gemini') {
      return null;
    }

    const isLoading = voiceSampleLoadingId === voiceId;
    const isPlaying = voiceSamplePlayingId === voiceId;
    const disabled = !voiceId || Boolean(voiceSampleLoadingId);

    return (
      <button
        type="button"
        onClick={() => void handlePreviewGeminiVoice(voiceId)}
        disabled={disabled}
        style={{
          height: '36px',
          borderRadius: '11px',
          border: isPlaying
            ? '1px solid rgba(0,255,4,0.45)'
            : '1px solid rgba(0,255,4,0.22)',
          background: isPlaying ? 'rgba(0,255,4,0.16)' : 'rgba(0,255,4,0.07)',
          color: disabled && !isLoading ? 'rgba(255,255,255,0.4)' : '#E8FFE9',
          fontSize: '11px',
          fontWeight: 800,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {isLoading ? 'Generuję próbkę...' : isPlaying ? 'Zatrzymaj odsłuch' : `Odsłuchaj ${label}`}
      </button>
    );
  }

  function handleApplyStyleCaptionDefaults(defaults: GeneratorCaptionDefaults) {
    const nextStyle = styleOptions.some((option) => option.value === defaults.style)
      ? defaults.style
      : 'highlight';
    setStyle(nextStyle);
    setFontSize(defaults.fontSize);
    setLineColor(defaults.lineColor.toUpperCase());
    setWordColor(defaults.wordColor.toUpperCase());
    setOutlineColor(defaults.outlineColor.toUpperCase());
    setNotice('Zapisany preset podglądu zastosował ustawienia napisów w generatorze.');
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const captionSettings = buildCaptionSettings({
        style,
        fontSize,
        lineColor,
        wordColor,
        outlineColor,
      });

      const payload: Record<string, unknown> = {
        title,
        language,
        cover_style: getSavedGeneratorCoverDefaults(),
        tts: {
          provider: ttsProvider,
          voice1: selectedVoice1,
          voice2: selectedVoice2,
          ...(ttsProvider === 'gemini'
            ? {
                geminiStyle,
                geminiTempo,
              }
            : {}),
        },
        avatar: {
          provider: 'soulx',
        },
        review: {
          mode: inputMode === 'script' ? reviewMode : 'off',
        },
      };

      if (inputMode === 'script') {
        payload.raw_text = payloadText;
      } else if (inputMode === 'conversation') {
        payload.conversation = JSON.parse(payloadText);
      } else {
        payload.transcript = JSON.parse(payloadText);
      }

      if (workflowMode === 'workflow-a') {
        payload.exact_captions = exactCaptions;
        payload.style = style;
        payload.font_size = Number(fontSize);
        payload.line_color = lineColor;
        payload.word_color = wordColor;
        payload.outline_color = outlineColor;
      } else {
        payload.captions = style === 'off' ? 'off' : 'burn';
        payload.caption_style = style === 'classic' ? 'classic' : style === 'off' ? 'off' : 'highlight';
        payload.caption_font_size = Number(fontSize);
        payload.caption_line_color = lineColor;
        payload.caption_word_color = wordColor;
        payload.caption_outline_color = outlineColor;
      }

      const endpoint =
        workflowMode === 'workflow-a'
          ? '/api/podcast-video/jobs'
          : '/api/podcast-video/podcast-film/jobs';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(readString(data, 'error') || readString(data, 'detail') || 'Failed to create podcast video job.');
      }

      if (data.review_required === true && Array.isArray(data.conversation)) {
        setInputMode('conversation');
        setPayloadText(JSON.stringify(data.conversation, null, 2));
        setNotice(
          'Draft conversation jest gotowy. Sprawdź tekst, a potem kliknij ponownie, żeby uruchomić render z review.mode=off.'
        );
        setActiveJob(null);
        return;
      }

      if (workflowMode === 'workflow-a') {
        if (!isRecord(data.job)) {
          throw new Error('Workflow A returned an unexpected response shape.');
        }

        setActiveJob(
          normalizeWorkflowAJob(
            data.job,
            readString(data, 'statusUrl'),
            null,
            ttsProvider
          )
        );
        setNotice('Workflow A został uruchomiony z nowymi ustawieniami video.');
        return;
      }

      const jobId = readString(data, 'job_id');
      const statusUrl = readString(data, 'status_url');
      if (!jobId || !statusUrl) {
        throw new Error('Workflow B returned an incomplete kickoff response.');
      }

      setActiveJob(
        createWorkflowBQueuedJob({
          jobId,
          statusUrl,
          title,
          language,
          provider: ttsProvider,
          reviewMode: inputMode === 'script' ? reviewMode : 'off',
          captionSettings,
        })
      );
      setNotice('Workflow B został uruchomiony. Status będzie aktualizowany automatycznie.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to submit job.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCoverUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCoverMessage(null);

    if (!selectedCoverFile) {
      setError('Wybierz plik PNG do podmiany covera.');
      return;
    }

    try {
      setIsUploadingCover(true);
      const formData = new FormData();
      formData.append('file', selectedCoverFile);

      const response = await fetch('/api/podcast-video/cover', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.NEXT_PUBLIC_APP_API_KEY || '',
        },
        body: formData,
      });

      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(readString(data, 'error') || 'Failed to update podcast cover.');
      }

      setCoverVersion(Date.now());
      setSelectedCoverFile(null);
      setCoverMessage('Cover PNG został zaktualizowany.');
    } catch (uploadError) {
      setCoverError(uploadError instanceof Error ? uploadError.message : 'Failed to update cover.');
    } finally {
      setIsUploadingCover(false);
    }
  }

  async function handleDeleteHistoryJob(jobId: string) {
    setHistoryError(null);
    setDeletingJobId(jobId);

    try {
      const response = await fetch(`/api/podcast-video/jobs/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(readString(data, 'error') || 'Failed to delete archived video job.');
      }

      setArmedDeleteJobId((current) => (current === jobId ? null : current));
      setSelectedPreviewJobId((current) => (current === jobId ? null : current));
      setActiveJob((current) => {
        if (!current || current.jobId !== jobId) {
          return current;
        }
        if (current.status === 'queued' || current.status === 'running') {
          return current;
        }
        return null;
      });
      await loadHistory();
      setNotice('Archiwalny render został usunięty.');
    } catch (deleteError) {
      setHistoryError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Failed to delete archived video job.'
      );
    } finally {
      setDeletingJobId(null);
    }
  }

  return (
    <div className="monolith-container">
      <div className="slab" style={{ padding: '32px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="monolith-title">Pipeline: Video Control Deck</div>
          <h1 style={{ fontSize: '32px', fontWeight: 800, margin: 0, color: 'white' }}>
            Wszystkie opcje video w jednym miejscu
          </h1>
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: '14px',
              maxWidth: '900px',
              lineHeight: 1.6,
            }}
          >
            Ten ekran spina teraz workflow A i workflow B, wybór providera TTS, głosy oraz
            sterowanie renderem. Nie musisz już skakać między audio page i video page, jeśli
            kończysz w MP4.
          </p>
          <div className="podcast-page-tabs" aria-label="Zakładki podcast video">
            <button
              type="button"
              className={`podcast-page-tab ${deckTab === 'generator' ? 'active' : ''}`}
              onClick={() => setDeckTab('generator')}
            >
              Generator
            </button>
            <button
              type="button"
              className={`podcast-page-tab ${deckTab === 'style-preview' ? 'active' : ''}`}
              onClick={() => setDeckTab('style-preview')}
            >
              Podgląd stylu
            </button>
          </div>
        </div>
      </div>

      {deckTab === 'style-preview' ? (
        <PodcastStylePreview
          coverUrl={coverUrl}
          onApplyCaptionDefaults={handleApplyStyleCaptionDefaults}
        />
      ) : (
      <div className="monolith-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <section className="slab">
            <div className="section-header">
              <h2 className="monolith-title">Konfiguracja Pipeline</h2>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div
                style={{
                  padding: '18px',
                  borderRadius: '18px',
                  background:
                    'linear-gradient(135deg, rgba(0,255,4,0.08), rgba(255,255,255,0.02) 55%, rgba(0,0,0,0.25))',
                  border: '1px solid rgba(0,255,4,0.18)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                }}
              >
                <div className="monolith-title">Sequential Flow</div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '12px',
                  }}
                >
                  {wizardSteps.map((step) => (
                    <div
                      key={step.number}
                      style={{
                        padding: '14px',
                        borderRadius: '14px',
                        background: step.done ? 'rgba(0,255,4,0.08)' : 'rgba(255,255,255,0.03)',
                        border: step.done
                          ? '1px solid rgba(0,255,4,0.18)'
                          : '1px solid rgba(255,255,255,0.06)',
                        minHeight: '118px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                        <div className="monolith-title" style={{ fontSize: '10px' }}>
                          Krok {step.number}
                        </div>
                        <div style={{ fontSize: '10px', color: step.done ? '#9DFFA0' : 'var(--text-muted)' }}>
                          {step.done ? 'READY' : 'WAITING'}
                        </div>
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: 800, color: 'white' }}>{step.title}</div>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#E8FFE9' }}>{step.value}</div>
                      <div style={{ fontSize: '11px', lineHeight: 1.5, color: 'var(--text-muted)' }}>
                        {step.description}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  Po kolei ustawiasz wejście, workflow, głosy i render. Potem klikasz jeden przycisk,
                  a status oraz gotowy film wracają na tę samą stronę.
                </div>
              </div>

              <section
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  padding: '18px',
                  borderRadius: '18px',
                  background: 'rgba(255,255,255,0.025)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <div className="monolith-title">Krok 1</div>
                    <h3 style={{ margin: '4px 0 0', fontSize: '22px', color: 'white' }}>Źródło i treść</h3>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{inputModeDescription(inputMode)}</div>
                </div>

                <div className="tab-group" style={{ padding: '4px', width: 'fit-content' }}>
                  <button
                    type="button"
                    className={`tab-btn ${inputMode === 'script' ? 'active' : ''}`}
                    onClick={() => setInputMode('script')}
                  >
                    TEKST
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${inputMode === 'conversation' ? 'active' : ''}`}
                    onClick={() => setInputMode('conversation')}
                  >
                    CONVO
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${inputMode === 'transcript' ? 'active' : ''}`}
                    onClick={() => workflowMode === 'workflow-a' && setInputMode('transcript')}
                    disabled={workflowMode !== 'workflow-a'}
                    style={{ opacity: workflowMode === 'workflow-a' ? 1 : 0.45 }}
                  >
                    TRANSCRIPT
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="monolith-title" style={{ fontSize: '11px' }}>Tytuł Projektu</label>
                    <input
                      className="excavated-input"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Wpisz nazwę podcastu..."
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="monolith-title" style={{ fontSize: '11px' }}>Język</label>
                    <select
                      className="monolith-select"
                      value={language}
                      onChange={(event) => setLanguage(event.target.value)}
                    >
                      <option value="pl">Polski 🇵🇱</option>
                      <option value="en">English 🇺🇸</option>
                      <option value="de">Deutsch 🇩🇪</option>
                      <option value="fr">Français 🇫🇷</option>
                    </select>
                  </div>
                </div>

                <textarea
                  className="monolith-textarea"
                  value={payloadText}
                  onChange={(event) => setPayloadText(event.target.value)}
                  placeholder={placeholder}
                  style={{ minHeight: '280px', fontSize: '13px', lineHeight: 1.6 }}
                />
              </section>

              <section
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  padding: '18px',
                  borderRadius: '18px',
                  background: 'rgba(255,255,255,0.025)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div>
                  <div className="monolith-title">Krok 2</div>
                  <h3 style={{ margin: '4px 0 0', fontSize: '22px', color: 'white' }}>Wybierz workflow</h3>
                </div>

                <div className="tab-group" style={{ padding: '4px', width: 'fit-content' }}>
                  <button
                    type="button"
                    className={`tab-btn ${workflowMode === 'workflow-a' ? 'active' : ''}`}
                    onClick={() => setWorkflowMode('workflow-a')}
                  >
                    A / COVER VIDEO
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${workflowMode === 'workflow-b' ? 'active' : ''}`}
                    onClick={() => setWorkflowMode('workflow-b')}
                  >
                    B / AVATAR VIDEO
                  </button>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '14px',
                  }}
                >
                  <div
                    style={{
                      padding: '14px',
                      borderRadius: '14px',
                      background: workflowMode === 'workflow-a' ? 'rgba(0,255,4,0.08)' : 'rgba(255,255,255,0.03)',
                      border: workflowMode === 'workflow-a'
                        ? '1px solid rgba(0,255,4,0.18)'
                        : '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '6px' }}>Workflow A</div>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: 'white', marginBottom: '6px' }}>
                      Cover video
                    </div>
                    <div style={{ fontSize: '12px', lineHeight: 1.6, color: 'var(--text-muted)' }}>
                      Obsługuje `raw_text`, `conversation` i legacy `transcript`. Daje pełny pakiet artefaktów audio, captions i MP4.
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '14px',
                      borderRadius: '14px',
                      background: workflowMode === 'workflow-b' ? 'rgba(0,255,4,0.08)' : 'rgba(255,255,255,0.03)',
                      border: workflowMode === 'workflow-b'
                        ? '1px solid rgba(0,255,4,0.18)'
                        : '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '6px' }}>Workflow B</div>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: 'white', marginBottom: '6px' }}>
                      Avatar video
                    </div>
                    <div style={{ fontSize: '12px', lineHeight: 1.6, color: 'var(--text-muted)' }}>
                      Obsługuje `raw_text` i `conversation`. Używa SoulX do segmentów avatar i skleja wynik do finalnego MP4.
                    </div>
                  </div>
                </div>
              </section>

              <section
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  padding: '18px',
                  borderRadius: '18px',
                  background: 'rgba(255,255,255,0.025)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div>
                  <div className="monolith-title">Krok 3</div>
                  <h3 style={{ margin: '4px 0 0', fontSize: '22px', color: 'white' }}>TTS i głosy</h3>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="monolith-title" style={{ fontSize: '11px' }}>Provider TTS</label>
                    <select
                      className="monolith-select"
                      value={ttsProvider}
                      onChange={(event) => setTtsProvider(event.target.value as VideoTtsProvider)}
                    >
                      {availableProviders.map((provider) => (
                        <option key={provider} value={provider}>
                          {providerLabel(provider)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: '14px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>Katalog</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>
                      {isLoadingVoices ? 'Ładowanie głosów' : providerLabel(ttsProvider)}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: '14px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>Render</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>
                      {renderLabel(workflowMode)}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '16px',
                  }}
                >
                  {ttsProvider === 'gemini' && (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label className="monolith-title" style={{ fontSize: '11px' }}>Gemini Style</label>
                        <select
                          className="monolith-select"
                          value={geminiStyle}
                          onChange={(event) => setGeminiStyle(event.target.value as GeminiStyle)}
                        >
                          <option value="expressive-lite">Expressive Lite</option>
                          <option value="plain">Plain</option>
                        </select>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label className="monolith-title" style={{ fontSize: '11px' }}>Gemini Tempo</label>
                        <select
                          className="monolith-select"
                          value={geminiTempo}
                          onChange={(event) => setGeminiTempo(event.target.value as GeminiTempo)}
                        >
                          <option value="normal">Normal</option>
                          <option value="fast">Fast</option>
                        </select>
                      </div>
                    </>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="monolith-title" style={{ fontSize: '11px' }}>Głos 1</label>
                    <select
                      className="monolith-select"
                      value={selectedVoice1}
                      onChange={(event) => setSelectedVoice1(event.target.value)}
                      disabled={isLoadingVoices}
                    >
                      {groupedVoices.male.length > 0 && (
                        <optgroup label="Męskie">
                          {groupedVoices.male.map((voice) => (
                            <option key={`voice1-male-${voice.id}`} value={voice.id}>
                              {voice.name}
                              {voice.style ? ` (${voice.style})` : voice.defaultImageFolder ? ` (${voice.defaultImageFolder})` : ''}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {groupedVoices.female.length > 0 && (
                        <optgroup label="Żeńskie">
                          {groupedVoices.female.map((voice) => (
                            <option key={`voice1-female-${voice.id}`} value={voice.id}>
                              {voice.name}
                              {voice.style ? ` (${voice.style})` : voice.defaultImageFolder ? ` (${voice.defaultImageFolder})` : ''}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {groupedVoices.unknown.length > 0 && (
                        <optgroup label="Inne">
                          {groupedVoices.unknown.map((voice) => (
                            <option key={`voice1-other-${voice.id}`} value={voice.id}>
                              {voice.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {renderGeminiSampleButton(selectedVoice1, 'głos 1')}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="monolith-title" style={{ fontSize: '11px' }}>Głos 2</label>
                    <select
                      className="monolith-select"
                      value={selectedVoice2}
                      onChange={(event) => setSelectedVoice2(event.target.value)}
                      disabled={isLoadingVoices}
                    >
                      {groupedVoices.female.length > 0 && (
                        <optgroup label="Żeńskie">
                          {groupedVoices.female.map((voice) => (
                            <option key={`voice2-female-${voice.id}`} value={voice.id}>
                              {voice.name}
                              {voice.style ? ` (${voice.style})` : voice.defaultImageFolder ? ` (${voice.defaultImageFolder})` : ''}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {groupedVoices.male.length > 0 && (
                        <optgroup label="Męskie">
                          {groupedVoices.male.map((voice) => (
                            <option key={`voice2-male-${voice.id}`} value={voice.id}>
                              {voice.name}
                              {voice.style ? ` (${voice.style})` : voice.defaultImageFolder ? ` (${voice.defaultImageFolder})` : ''}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {groupedVoices.unknown.length > 0 && (
                        <optgroup label="Inne">
                          {groupedVoices.unknown.map((voice) => (
                            <option key={`voice2-other-${voice.id}`} value={voice.id}>
                              {voice.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {renderGeminiSampleButton(selectedVoice2, 'głos 2')}
                  </div>
                </div>

                {ttsProvider === 'gemini' && (
                  <div
                    style={{
                      padding: '11px 12px',
                      borderRadius: '12px',
                      background: voiceSampleError ? 'rgba(255,80,80,0.08)' : 'rgba(0,255,4,0.05)',
                      border: voiceSampleError
                        ? '1px solid rgba(255,80,80,0.22)'
                        : '1px solid rgba(0,255,4,0.14)',
                      color: voiceSampleError ? '#FFB4B4' : 'var(--text-muted)',
                      fontSize: '12px',
                      lineHeight: 1.5,
                    }}
                  >
                    {voiceSampleError ||
                      voiceSampleNotice ||
                      'Odsłuch Gemini generuje krótki WAV przy pierwszym kliknięciu i potem używa cache z archive/voice-samples/gemini.'}
                    {voiceSampleAudioSrc && (
                      <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div className="monolith-title" style={{ fontSize: '10px' }}>
                          Próbka: {voiceSampleAudioLabel || 'Gemini'}
                        </div>
                        <audio
                          ref={voiceSampleAudioRef}
                          controls
                          src={voiceSampleAudioSrc}
                          onPlay={() => setVoiceSamplePlayingId(voiceSampleAudioVoiceId)}
                          onPause={() => setVoiceSamplePlayingId(null)}
                          onEnded={() => setVoiceSamplePlayingId(null)}
                          onError={() => setVoiceSampleError('Nie można odtworzyć wygenerowanej próbki audio.')}
                          style={{ width: '100%', height: '34px' }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  padding: '18px',
                  borderRadius: '18px',
                  background: 'rgba(255,255,255,0.025)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div>
                  <div className="monolith-title">Krok 4</div>
                  <h3 style={{ margin: '4px 0 0', fontSize: '22px', color: 'white' }}>Review, napisy i render</h3>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="monolith-title" style={{ fontSize: '11px' }}>Review Mode</label>
                    <select
                      className="monolith-select"
                      value={reviewMode}
                      onChange={(event) => setReviewMode(event.target.value as ReviewMode)}
                      disabled={inputMode !== 'script'}
                    >
                      <option value="off">Render od razu</option>
                      <option value="pause_after_conversation">Zatrzymaj po conversation</option>
                    </select>
                  </div>
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: '14px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>Workflow</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>{workflowLabel(workflowMode)}</div>
                  </div>
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: '14px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>Finalny tor</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>{flowSummary}</div>
                  </div>
                </div>

                {workflowMode === 'workflow-a' ? (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '12px 14px',
                      borderRadius: '12px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.05)',
                      fontSize: '13px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={exactCaptions}
                      onChange={(event) => setExactCaptions(event.target.checked)}
                    />
                    <span>
                      Użyj oryginalnego transcriptu 1:1. Dla `highlight` system przełączy się na lokalny
                      renderer słowo po słowie; gdy transcript nie ma `words[]`, spadnie do exact `classic`.
                    </span>
                  </label>
                ) : (
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: '12px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.05)',
                      fontSize: '13px',
                      color: 'var(--text-muted)',
                      lineHeight: 1.6,
                    }}
                  >
                    Workflow B wypala napisy bezpośrednio do wideo. Dla `Gemini` i `ElevenLabs` timing słów jest
                    szacowany na podstawie segmentów, więc najbardziej przewidywalne są style `highlight` i `classic`.
                  </div>
                )}

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: '16px',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="monolith-title" style={{ fontSize: '10px' }}>Styl</label>
                    <select
                      className="monolith-select"
                      value={style}
                      onChange={(event) => setStyle(event.target.value)}
                    >
                      {styleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="monolith-title" style={{ fontSize: '10px' }}>Rozmiar</label>
                    <input
                      className="excavated-input"
                      value={fontSize}
                      onChange={(event) => setFontSize(event.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="monolith-title" style={{ fontSize: '10px' }}>Tekst</label>
                    <input
                      type="color"
                      className="excavated-input"
                      value={lineColor}
                      onChange={(event) => setLineColor(event.target.value.toUpperCase())}
                      style={{ padding: '4px', cursor: 'pointer', height: '46px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="monolith-title" style={{ fontSize: '10px' }}>Akcent</label>
                    <input
                      type="color"
                      className="excavated-input"
                      value={wordColor}
                      onChange={(event) => setWordColor(event.target.value.toUpperCase())}
                      style={{ padding: '4px', cursor: 'pointer', height: '46px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="monolith-title" style={{ fontSize: '10px' }}>Obrys</label>
                    <input
                      type="color"
                      className="excavated-input"
                      value={outlineColor}
                      onChange={(event) => setOutlineColor(event.target.value.toUpperCase())}
                      style={{ padding: '4px', cursor: 'pointer', height: '46px' }}
                    />
                  </div>
                </div>
              </section>

              <section
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  padding: '18px',
                  borderRadius: '18px',
                  background:
                    'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,255,4,0.03))',
                  border: '1px solid rgba(0,255,4,0.14)',
                }}
              >
                <div>
                  <div className="monolith-title">Krok 5</div>
                  <h3 style={{ margin: '4px 0 0', fontSize: '22px', color: 'white' }}>Podsumowanie i start</h3>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '14px',
                  }}
                >
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: '14px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>Input</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>{inputModeLabel(inputMode)}</div>
                  </div>
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: '14px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>Pipeline</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>{flowSummary}</div>
                  </div>
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: '14px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>Review</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>
                      {inputMode === 'script'
                        ? reviewMode === 'pause_after_conversation'
                          ? 'Pause po conversation'
                          : 'Render od razu'
                        : 'Bez pauzy'}
                    </div>
                  </div>
                </div>

                {notice && (
                  <div
                    style={{
                      padding: '12px',
                      background: 'rgba(0,255,4,0.08)',
                      borderRadius: '12px',
                      border: '1px solid rgba(0,255,4,0.22)',
                      fontSize: '12px',
                      color: '#9DFFA0',
                    }}
                  >
                    {notice}
                  </div>
                )}

                {error && (
                  <div
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#ef4444',
                      padding: '12px',
                      borderRadius: '12px',
                      fontSize: '13px',
                    }}
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting || !isReadyToGenerate}
                  className={`monolith-btn primary ${isSubmitting ? 'generating-audio' : ''}`}
                  style={{ height: '58px', fontSize: '15px' }}
                >
                  {isSubmitting
                    ? 'INICJALIZACJA PROCESU...'
                    : workflowMode === 'workflow-a'
                      ? 'GENERUJ COVER VIDEO'
                      : 'GENERUJ AVATAR VIDEO'}
                </button>
              </section>
            </form>
          </section>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <section className="slab" ref={previewSectionRef}>
            <div className="section-header">
              <h2 className="monolith-title">Ostatni zapisany film</h2>
            </div>

            {previewJob?.artifacts.mp4_url ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {previewArchiveNotice && (
                  <div
                    style={{
                      padding: '12px',
                      background:
                        activeJob?.status === 'failed'
                          ? 'rgba(239, 68, 68, 0.10)'
                          : 'rgba(245, 158, 11, 0.10)',
                      borderRadius: '12px',
                      border:
                        activeJob?.status === 'failed'
                          ? '1px solid rgba(239, 68, 68, 0.28)'
                          : '1px solid rgba(245, 158, 11, 0.28)',
                      fontSize: '12px',
                      color: activeJob?.status === 'failed' ? '#FFB4B4' : '#F6C970',
                    }}
                  >
                    {previewArchiveNotice}
                  </div>
                )}

                <video
                  key={previewJob.jobId}
                  src={previewJob.artifacts.mp4_url}
                  controls
                  className="slab"
                  style={{
                    width: '100%',
                    padding: 0,
                    overflow: 'hidden',
                    background: 'black',
                    borderRadius: '16px',
                  }}
                />

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: '12px',
                  }}
                >
                  <div
                    style={{
                      padding: '12px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>
                      Tytuł
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>{previewJob.title}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {previewMatchesActiveJob ? `Job ${previewJob.jobId}` : `Archiwum: ${previewJob.jobId}`}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '12px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>
                      Workflow
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>
                      {workflowLabel(previewJob.workflow)}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '12px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>
                      Zapisano
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>
                      {formatDateTime(previewJob.updatedAt || previewJob.createdAt)}
                    </div>
                  </div>
                </div>
              </div>
            ) : isLoadingHistory ? (
              <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: '13px' }}>
                Ładowanie ostatniego zapisanego filmu...
              </div>
            ) : (
              <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: '13px' }}>
                Nie ma jeszcze żadnego zapisanego MP4 w archiwum.
              </div>
            )}
          </section>

          <section className="slab">
            <div className="section-header">
              <h2 className="monolith-title">Poprzednie renderingi</h2>
            </div>

            {historyError && (
              <div
                style={{
                  marginBottom: '12px',
                  padding: '12px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '12px',
                  fontSize: '12px',
                  color: '#ef4444',
                }}
              >
                {historyError}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {isLoadingHistory && jobHistory.length === 0 ? (
                <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '12px' }}>
                  Ładowanie archiwum video...
                </div>
              ) : jobHistory.length === 0 ? (
                <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '12px' }}>
                  Archiwum jest puste. Po pierwszym udanym renderze zapisany MP4 pojawi się tutaj.
                </div>
              ) : (
                jobHistory.map((job) => {
                  const isSelected = previewJob?.jobId === job.jobId;
                  const isArmed = armedDeleteJobId === job.jobId;
                  const isDeleting = deletingJobId === job.jobId;

                  return (
                    <div
                      key={job.jobId}
                      style={{
                        padding: '14px',
                        borderRadius: '14px',
                        background: isSelected ? 'rgba(0,255,4,0.08)' : 'rgba(255,255,255,0.03)',
                        border: isSelected
                          ? '1px solid rgba(0,255,4,0.18)'
                          : '1px solid rgba(255,255,255,0.06)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '14px', fontWeight: 800, color: 'white' }}>
                            {job.title}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            {workflowLabel(job.workflow)} / {providerLabel(job.ttsProvider)} / {formatDateTime(job.updatedAt || job.createdAt)}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {job.jobId}
                          </div>
                        </div>
                        <div
                          style={{
                            fontSize: '10px',
                            fontWeight: 800,
                            color: isSelected ? '#9DFFA0' : 'var(--text-muted)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {isSelected ? 'PREVIEW' : 'ARCHIVE'}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className={`monolith-btn ${isSelected ? 'primary' : ''}`}
                          onClick={() => {
                            setSelectedPreviewJobId(job.jobId);
                            setArmedDeleteJobId(null);
                          }}
                        >
                          {isSelected ? 'AKTYWNY PODGLĄD' : 'POKAŻ FILM'}
                        </button>

                        {isArmed ? (
                          <>
                            <button
                              type="button"
                              className="monolith-btn"
                              onClick={() => void handleDeleteHistoryJob(job.jobId)}
                              disabled={isDeleting}
                              style={{
                                borderColor: 'rgba(239, 68, 68, 0.4)',
                                color: '#FF8F8F',
                                opacity: isDeleting ? 0.7 : 1,
                              }}
                            >
                              {isDeleting ? 'USUWANIE...' : 'POTWIERDŹ USUNIĘCIE'}
                            </button>
                            <button
                              type="button"
                              className="monolith-btn"
                              onClick={() => setArmedDeleteJobId(null)}
                              disabled={isDeleting}
                            >
                              ANULUJ
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="monolith-btn"
                            onClick={() => setArmedDeleteJobId(job.jobId)}
                            style={{
                              borderColor: 'rgba(239, 68, 68, 0.25)',
                              color: '#FFB4B4',
                            }}
                          >
                            USUŃ
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="slab" ref={statusSectionRef}>
            <div className="section-header">
              <h2 className="monolith-title">Cover Podcastu</h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                className="slab"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  borderRadius: '16px',
                  background: 'rgba(0,0,0,0.45)',
                }}
              >
                <div style={{ maxWidth: '240px', margin: '0 auto', width: '100%' }}>
                  <img
                    src={coverUrl}
                    alt="Aktualny cover podcast video"
                    style={{
                      width: '100%',
                      display: 'block',
                      aspectRatio: '9 / 16',
                      objectFit: 'contain',
                      background: '#05070d',
                      borderRadius: '12px',
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  padding: '12px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '6px' }}>
                  Aktywny plik
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    wordBreak: 'break-all',
                  }}
                >
                  /root/AiPodcast/podcast_cover.png
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <input
                  type="file"
                  accept="image/png"
                  ref={fileInputRef}
                  onChange={(event) => {
                    setCoverError(null);
                    setCoverMessage(null);
                    setSelectedCoverFile(event.target.files?.[0] || null);
                  }}
                  style={{ display: 'none' }}
                />

                <button
                  type="button"
                  className="monolith-btn"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    background: selectedCoverFile ? 'rgba(74, 222, 128, 0.1)' : 'rgba(255,255,255,0.03)',
                    borderColor: selectedCoverFile ? 'var(--accent-celadon)' : 'rgba(255,255,255,0.1)',
                  }}
                >
                  {selectedCoverFile ? 'Zmień wybrany plik' : 'WYBIERZ PLIK PNG...'}
                </button>

                {selectedCoverFile && (
                  <div
                    style={{
                      padding: '10px 12px',
                      background: 'rgba(74, 222, 128, 0.05)',
                      borderRadius: '12px',
                      border: '1px solid rgba(74, 222, 128, 0.2)',
                      fontSize: '12px',
                      color: 'var(--accent-celadon)',
                    }}
                  >
                    Wybrano: <strong>{selectedCoverFile.name}</strong>
                  </div>
                )}

                {coverError && (
                  <div
                    style={{
                      padding: '12px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '12px',
                      fontSize: '12px',
                      color: '#ef4444',
                    }}
                  >
                    {coverError}
                  </div>
                )}

                {coverMessage && (
                  <div
                    style={{
                      padding: '12px',
                      background: 'rgba(0,255,4,0.08)',
                      borderRadius: '12px',
                      border: '1px solid rgba(0,255,4,0.22)',
                      fontSize: '12px',
                      color: '#9DFFA0',
                    }}
                  >
                    {coverMessage}
                  </div>
                )}

                {selectedCoverFile && (
                  <form onSubmit={handleCoverUpload}>
                    <button
                      type="submit"
                      className="monolith-btn primary"
                      disabled={isUploadingCover}
                      style={{
                        opacity: isUploadingCover ? 0.7 : 1,
                        width: '100%',
                        height: '46px',
                        marginTop: '4px',
                      }}
                    >
                      {isUploadingCover ? 'PRZESYŁANIE...' : 'ZATWIERDŹ I PODMIEŃ COVER'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </section>

          <section className="slab">
            <div className="section-header">
              <h2 className="monolith-title">Status Renderowania</h2>
            </div>

            {!detailsJob ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#666', fontSize: '13px' }}>
                Brak aktywnego renderu i brak wybranego archiwalnego filmu.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>
                    {activeJob ? 'Aktywny Etap' : 'Wybrane Zadanie'}
                  </div>
                  <div style={{ fontSize: '14px', color: 'var(--accent-celadon)', fontWeight: 600 }}>
                    {detailsJob.stage}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                  <div
                    style={{
                      padding: '12px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>
                      Workflow
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>
                      {workflowLabel(detailsJob.workflow)}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '12px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>
                      TTS
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>
                      {providerLabel(detailsJob.ttsProvider)}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '12px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>
                      Render
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>
                      {detailsJob.renderMode || detailsJob.pipeline || detailsJob.engineUsed || 'pending'}
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div className="monolith-title" style={{ fontSize: '10px' }}>Postęp</div>
                    <div style={{ fontSize: '12px', fontWeight: 700 }}>{detailsJob.progress}%</div>
                  </div>
                  <div
                    style={{
                      height: '8px',
                      background: 'rgba(0,0,0,0.5)',
                      borderRadius: '4px',
                      overflow: 'hidden',
                      boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)',
                    }}
                  >
                    <div
                      style={{
                        width: `${detailsJob.progress}%`,
                        height: '100%',
                        background: 'var(--accent-celadon)',
                        boxShadow: '0 0 10px var(--accent-celadon-glow)',
                        transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                      }}
                    />
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: '12px',
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                  {detailsJob.message}
                </div>

                {detailsJob.fallbackReason && (
                  <div
                    style={{
                      padding: '12px',
                      background: 'rgba(245, 158, 11, 0.08)',
                      borderRadius: '12px',
                      border: '1px solid rgba(245, 158, 11, 0.22)',
                      fontSize: '12px',
                      color: '#F6C970',
                    }}
                  >
                    Fallback lokalny: {detailsJob.fallbackReason}
                  </div>
                )}

                {detailsJob.error && (
                  <div className="slab danger" style={{ padding: '12px', fontSize: '12px' }}>
                    {detailsJob.error}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="slab">
            <div className="section-header">
              <h2 className="monolith-title">Artefakty Pipeline</h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {artifactItems.length === 0 ? (
                <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '12px' }}>
                  Artefakty pojawią się po uruchomieniu joba.
                </div>
              ) : (
                artifactItems.map((item) => (
                  <div key={item.key} style={{ opacity: detailsJob ? 1 : 0.4 }}>
                    <a
                      href={item.url || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className={`monolith-btn ${item.emphasized ? 'primary' : ''}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        textDecoration: 'none',
                        opacity: item.url ? 1 : 0.55,
                        pointerEvents: item.url ? 'auto' : 'none',
                      }}
                    >
                      <span>{item.label}</span>
                      <span style={{ fontSize: '10px', fontWeight: item.emphasized ? 800 : 600 }}>
                        {item.ready ? 'READY' : 'WAITING'}
                      </span>
                    </a>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
      )}
    </div>
  );
}
