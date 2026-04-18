import type { NormalizedTranscript } from '@/lib/transcript-parser';

export type PodcastVideoStatus = 'queued' | 'running' | 'success' | 'failed';

export type PodcastVideoStage =
  | 'queued'
  | 'preparing-input'
  | 'generating-conversation'
  | 'generating-audio'
  | 'generating-audio-stems'
  | 'building-transcript'
  | 'uploading-assets'
  | 'composing-video'
  | 'rendering-captions'
  | 'success'
  | 'failed';

export interface PodcastConversationItem {
  speaker: string;
  text: string;
}

export interface PodcastVideoCaptionSettings {
  style: string;
  font_size: number;
  line_color: string;
  word_color: string;
  outline_color: string;
}

export interface PodcastVideoJobRequest {
  title?: string;
  language?: string;
  script_text?: string;
  conversation?: PodcastConversationItem[];
  transcript?: NormalizedTranscript;
  voice1?: string;
  voice2?: string;
  source_job_id?: string;
  exact_captions?: boolean;
  style?: string;
  font_size?: number;
  line_color?: string;
  word_color?: string;
  outline_color?: string;
}

export interface PodcastVideoArtifacts {
  json_url: string | null;
  mp3_url: string | null;
  srt_url: string | null;
  mp4_url: string | null;
  stem_speaker1_url: string | null;
  stem_speaker2_url: string | null;
  segment_urls: string[] | null;
}

export type PodcastVideoEngine = 'nca' | 'local' | null;

export type PodcastVideoRenderMode =
  | 'nca_auto'
  | 'nca_exact_classic'
  | 'local_highlight_exact'
  | 'local_classic_exact'
  | null;

export interface PodcastVideoArtifactFiles {
  transcript_path: string | null;
  audio_path: string | null;
  srt_path: string | null;
  mp4_path: string | null;
  status_path: string | null;
  stem_speaker1_path: string | null;
  stem_speaker2_path: string | null;
  segment_paths: string[] | null;
}

export interface PodcastVideoJobRecord {
  jobId: string;
  title: string;
  language: string;
  status: PodcastVideoStatus;
  stage: PodcastVideoStage;
  progress: number;
  message: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  sourceJobId: string | null;
  publicBaseUrl: string;
  captionSettings: PodcastVideoCaptionSettings;
  engineUsed: PodcastVideoEngine;
  renderMode: PodcastVideoRenderMode;
  fallbackReason: string | null;
  inputSummary: {
    hasScriptText: boolean;
    hasConversation: boolean;
    hasTranscript: boolean;
    conversationCount: number;
  };
  artifacts: PodcastVideoArtifacts;
  files: PodcastVideoArtifactFiles;
}

export const DEFAULT_PODCAST_VIDEO_CAPTION_SETTINGS: PodcastVideoCaptionSettings = {
  style: 'highlight',
  font_size: 86,
  line_color: '#FFFFFF',
  word_color: '#00FF04',
  outline_color: '#000000',
};

export const DEFAULT_PODCAST_VIDEO_VOICES = {
  voice1: 'nPczCjzI2devNBz1zQrb',
  voice2: 'EXAVITQu4vr4xnSDxMaL',
} as const;
