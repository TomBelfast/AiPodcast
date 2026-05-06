import type {
  AvatarProvider,
  ConversationDraftItem,
  GeminiStyle,
  GeminiTempo,
  ReviewMode,
  TtsProvider,
} from '@/lib/podcast/contracts';

export interface DialogueInput {
  text: string;
  voiceId: string;
  speaker?: string;
}

export interface CreateDialogueRequest {
  inputs: DialogueInput[];
  conversation?: ConversationDraftItem[];
  raw_text?: string;
  language?: string;
  modelId?: string;
  seed?: number;
  apiKey?: string;
  includeTimestamps?: boolean;
  provider?: TtsProvider;
  ttsProvider?: TtsProvider;
  ttsEngine?: string;
  geminiApiKey?: string;
  elevenlabsApiKey?: string;
  geminiStyle?: GeminiStyle;
  geminiTempo?: GeminiTempo;
  tts?: {
    provider?: TtsProvider;
    voice1?: string;
    voice2?: string;
    model?: string;
    geminiStyle?: GeminiStyle;
    geminiTempo?: GeminiTempo;
  };
  avatar?: {
    provider?: AvatarProvider;
    model?: string;
  };
  review?: {
    mode?: ReviewMode;
  };
  dryRun?: boolean;
}

export interface VoiceSegment {
  voiceId: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  characterStartIndex: number;
  characterEndIndex: number;
  dialogueInputIndex: number;
}

export interface CharacterAlignment {
  characters: string[];
  characterStartTimesSeconds: number[];
  characterEndTimesSeconds: number[];
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export const Ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const Err = <T>(error: string): Result<T> => ({ ok: false, error });
