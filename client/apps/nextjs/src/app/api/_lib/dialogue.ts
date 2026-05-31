import fs from "fs";
import { PHONETIC_RULE } from "./llm";

const DIALOGUE_PATH = "/app/dialogue-settings.json";

export interface Host {
  name: string;
  gender: "female" | "male";  // → preset głosu (female/male) z tts-settings
  personality: string;
}

export interface DialogueSettings {
  hostA: Host;
  hostB: Host;
  minExchanges: number;
  maxExchanges: number;
  temperature: number;
}

export const DEFAULT_DIALOGUE: DialogueSettings = {
  hostA: {
    name: "Ania",
    gender: "female",
    personality: "entuzjastyczna, opowiada anegdoty, odnosi tematy do codziennego życia, czasem przerywa z podekscytowaniem",
  },
  hostB: {
    name: "Marek",
    gender: "male",
    personality: "analityczny, zadaje pytania wyjaśniające, robi odniesienia do popkultury, czasem kończy zdania drugiej osoby",
  },
  minExchanges: 8,
  maxExchanges: 20,
  temperature: 0.75,
};

export function readDialogue(): DialogueSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(DIALOGUE_PATH, "utf8")) as Partial<DialogueSettings>;
    return {
      hostA: { ...DEFAULT_DIALOGUE.hostA, ...(raw.hostA ?? {}) },
      hostB: { ...DEFAULT_DIALOGUE.hostB, ...(raw.hostB ?? {}) },
      minExchanges: typeof raw.minExchanges === "number" ? raw.minExchanges : DEFAULT_DIALOGUE.minExchanges,
      maxExchanges: typeof raw.maxExchanges === "number" ? raw.maxExchanges : DEFAULT_DIALOGUE.maxExchanges,
      temperature: typeof raw.temperature === "number" ? raw.temperature : DEFAULT_DIALOGUE.temperature,
    };
  } catch {
    return DEFAULT_DIALOGUE;
  }
}

export function writeDialogue(next: DialogueSettings): void {
  fs.writeFileSync(DIALOGUE_PATH, JSON.stringify(next, null, 2));
}

/** Buduje system+user prompt dialogu z ustawień (imiona/charaktery/liczba wymian). */
export function buildDialoguePrompt(summaryText: string): { system: string; user: string; hostA: Host; hostB: Host } {
  const d = readDialogue();
  const { hostA: a, hostB: b } = d;
  const system = `Jesteś scenarzystą podcastów. Tworzysz naturalne, wciągające dialogi po polsku między dwójką prowadzących:
- ${a.name}: ${a.personality}
- ${b.name}: ${b.personality}

Zasady:
1. Dialogi mają brzmieć naturalnie — używaj "no właśnie", "wiesz co", "dokładnie", "serio?", "kurde"
2. Format WYŁĄCZNIE: "${a.name}: tekst" lub "${b.name}: tekst" — każda kwestia w nowej linii
3. Minimum ${d.minExchanges}, maksimum ${d.maxExchanges} wymian
4. Zacznij od ${a.name} witającej słuchaczy i zapowiadającej temat

${PHONETIC_RULE}`;

  const user = `Na podstawie poniższego podsumowania utwórz skrypt podcastu jako dialog ${a.name} i ${b.name}.
Zachowaj wszystkie ważne informacje z podsumowania — zamień je w naturalną rozmowę.

PODSUMOWANIE:
${summaryText}`;

  return { system, user, hostA: a, hostB: b };
}
