export type TtsProvider = 'elevenlabs' | 'gemini' | 'openrouter';
export type VoiceGenderBucket = 'male' | 'female' | 'unknown';

export interface VoiceOption {
  id: string;
  name: string;
  provider: TtsProvider;
  category?: string;
  description?: string;
  genderBucket: VoiceGenderBucket;
  style?: string;
}

export const DEFAULT_ELEVENLABS_VOICES = {
  voice1: 'FF7KdobWPaiR0vkcALHF',
  voice2: 'BpjGufoPiobT79j2vtj4',
} as const;

export const DEFAULT_GEMINI_VOICES = {
  voice1: 'Charon',
  voice2: 'Kore',
} as const;

// Gemini does not expose official gender metadata for TTS voices.
// These buckets are curated locally for UI grouping only.
export const GEMINI_VOICE_OPTIONS: VoiceOption[] = [
  { id: 'Zephyr', name: 'Zephyr', provider: 'gemini', category: 'prebuilt', genderBucket: 'female', style: 'Bright' },
  { id: 'Puck', name: 'Puck', provider: 'gemini', category: 'prebuilt', genderBucket: 'male', style: 'Upbeat' },
  { id: 'Charon', name: 'Charon', provider: 'gemini', category: 'prebuilt', genderBucket: 'male', style: 'Informative' },
  { id: 'Kore', name: 'Kore', provider: 'gemini', category: 'prebuilt', genderBucket: 'female', style: 'Firm' },
  { id: 'Fenrir', name: 'Fenrir', provider: 'gemini', category: 'prebuilt', genderBucket: 'male', style: 'Excitable' },
  { id: 'Leda', name: 'Leda', provider: 'gemini', category: 'prebuilt', genderBucket: 'female', style: 'Youthful' },
  { id: 'Orus', name: 'Orus', provider: 'gemini', category: 'prebuilt', genderBucket: 'male', style: 'Firm' },
  { id: 'Aoede', name: 'Aoede', provider: 'gemini', category: 'prebuilt', genderBucket: 'female', style: 'Breezy' },
  { id: 'Callirrhoe', name: 'Callirrhoe', provider: 'gemini', category: 'prebuilt', genderBucket: 'female', style: 'Easy-going' },
  { id: 'Autonoe', name: 'Autonoe', provider: 'gemini', category: 'prebuilt', genderBucket: 'female', style: 'Bright' },
  { id: 'Enceladus', name: 'Enceladus', provider: 'gemini', category: 'prebuilt', genderBucket: 'male', style: 'Breathy' },
  { id: 'Iapetus', name: 'Iapetus', provider: 'gemini', category: 'prebuilt', genderBucket: 'male', style: 'Clear' },
  { id: 'Umbriel', name: 'Umbriel', provider: 'gemini', category: 'prebuilt', genderBucket: 'unknown', style: 'Easy-going' },
  { id: 'Algieba', name: 'Algieba', provider: 'gemini', category: 'prebuilt', genderBucket: 'unknown', style: 'Smooth' },
  { id: 'Despina', name: 'Despina', provider: 'gemini', category: 'prebuilt', genderBucket: 'female', style: 'Smooth' },
  { id: 'Erinome', name: 'Erinome', provider: 'gemini', category: 'prebuilt', genderBucket: 'female', style: 'Clear' },
  { id: 'Algenib', name: 'Algenib', provider: 'gemini', category: 'prebuilt', genderBucket: 'male', style: 'Gravelly' },
  { id: 'Rasalgethi', name: 'Rasalgethi', provider: 'gemini', category: 'prebuilt', genderBucket: 'male', style: 'Informative' },
  { id: 'Laomedeia', name: 'Laomedeia', provider: 'gemini', category: 'prebuilt', genderBucket: 'female', style: 'Upbeat' },
  { id: 'Achernar', name: 'Achernar', provider: 'gemini', category: 'prebuilt', genderBucket: 'unknown', style: 'Soft' },
  { id: 'Alnilam', name: 'Alnilam', provider: 'gemini', category: 'prebuilt', genderBucket: 'male', style: 'Firm' },
  { id: 'Schedar', name: 'Schedar', provider: 'gemini', category: 'prebuilt', genderBucket: 'unknown', style: 'Even' },
  { id: 'Gacrux', name: 'Gacrux', provider: 'gemini', category: 'prebuilt', genderBucket: 'male', style: 'Mature' },
  { id: 'Pulcherrima', name: 'Pulcherrima', provider: 'gemini', category: 'prebuilt', genderBucket: 'female', style: 'Forward' },
  { id: 'Achird', name: 'Achird', provider: 'gemini', category: 'prebuilt', genderBucket: 'unknown', style: 'Friendly' },
  { id: 'Zubenelgenubi', name: 'Zubenelgenubi', provider: 'gemini', category: 'prebuilt', genderBucket: 'unknown', style: 'Casual' },
  { id: 'Vindemiatrix', name: 'Vindemiatrix', provider: 'gemini', category: 'prebuilt', genderBucket: 'female', style: 'Gentle' },
  { id: 'Sadachbia', name: 'Sadachbia', provider: 'gemini', category: 'prebuilt', genderBucket: 'male', style: 'Lively' },
  { id: 'Sadaltager', name: 'Sadaltager', provider: 'gemini', category: 'prebuilt', genderBucket: 'male', style: 'Knowledgeable' },
  { id: 'Sulafat', name: 'Sulafat', provider: 'gemini', category: 'prebuilt', genderBucket: 'female', style: 'Warm' },
];

export const OPENROUTER_VOICE_OPTIONS: VoiceOption[] = GEMINI_VOICE_OPTIONS.map((voice) => ({
  ...voice,
  provider: 'openrouter' as const,
}));
