import fs from "fs";

const SETTINGS_PATH = "/app/tts-settings.json";

export interface VoicePreset {
  voice: string;   // F1..F5 / M1..M5
  speed: number;   // 0.7 - 1.5
  steps: number;   // 8 - 48 (jakość)
}

export interface TtsSettings {
  female: VoicePreset;
  male: VoicePreset;
  pause: number;   // silence_duration między kwestiami w dialogu (sek.)
}

export const DEFAULT_SETTINGS: TtsSettings = {
  female: { voice: "F1", speed: 1.05, steps: 32 },
  male: { voice: "M1", speed: 1.05, steps: 32 },
  pause: 0.4,
};

export function readSettings(): TtsSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as Partial<TtsSettings>;
    return {
      female: { ...DEFAULT_SETTINGS.female, ...(raw.female ?? {}) },
      male: { ...DEFAULT_SETTINGS.male, ...(raw.male ?? {}) },
      pause: typeof raw.pause === "number" ? raw.pause : DEFAULT_SETTINGS.pause,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(next: TtsSettings): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
}
