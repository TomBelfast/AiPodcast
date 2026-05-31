import fs from "fs";

const PROMPTS_PATH = "/app/prompt-settings.json";

export const ENGLISH_RULE =
  `Nazwy własne, marki, technologie i terminy techniczne ZAWSZE zostawiasz w oryginalnej angielskiej formie. Nigdy ich nie tłumaczysz ani nie przekształcasz fonetycznie.`;

export interface PromptDef {
  system: string;
  user: string; // może zawierać {transcript}; jeśli nie — transkrypt dopisany na końcu
}

// Domyślne prompty dla każdego stylu. {transcript} = miejsce wstawienia transkryptu.
export const DEFAULT_PROMPTS: Record<string, PromptDef> = {
  encyclopedic: {
    system: `Jesteś redaktorem encyklopedycznym piszącym po polsku w stylu Wikipedii. Piszesz jasno, zwięźle i neutralnie. Piszesz pełnymi zdaniami, bez list — styl narracyjny nadający się do czytania na głos. Unikasz żargonu — przy pojęciu technicznym dodajesz krótkie wyjaśnienie. ${ENGLISH_RULE}`,
    user: `Napisz szczegółowe podsumowanie w stylu artykułu encyklopedycznego. Zacznij od jednego zdania o czym jest materiał. Omów zagadnienia w logicznej kolejności — każde w osobnym akapicie. Zakończ wnioskami.\n\nTRANSKRYPT:\n{transcript}`,
  },
  short: {
    system: `Piszesz ultraskondensowane podsumowania po polsku. Maksymalnie 5 zdań. Zero lania wody. ${ENGLISH_RULE}`,
    user: `Napisz podsumowanie w MAKSYMALNIE 5 zdaniach. Tylko najważniejsze fakty i wnioski. Żadnych wstępów ani ozdobników.\n\nTRANSKRYPT:\n{transcript}`,
  },
  simple: {
    system: `Tłumaczysz skomplikowane tematy prostym językiem — jak dla 12-latka, który nigdy nie słyszał o tej dziedzinie. Używasz analogii z codziennego życia, unikasz żargonu. ${ENGLISH_RULE}`,
    user: `Napisz podsumowanie prostym, przystępnym językiem. Każde pojęcie techniczne wyjaśnij jednym prostym zdaniem lub analogią. Pisz tak, żeby zrozumiała osoba bez żadnego technicznego przygotowania.\n\nTRANSKRYPT:\n{transcript}`,
  },
  tv: {
    system: `Jesteś prezenterem wiadomości TVN24. Piszesz zwięźle, neutralnie i rzeczowo. Używasz stylu dziennikarskiego: "Eksperci wskazują…", "Jak podaje…", "Z informacji wynika…". Żadnych opinii, tylko fakty. ${ENGLISH_RULE}`,
    user: `Napisz materiał na wiadomości telewizyjne — 2-3 zwięzłe akapity. Zacznij od najmocniejszego faktu. Styl: neutralny, dziennikarski, bez emocji. Zakończ zdaniem podsumowującym znaczenie tematu.\n\nTRANSKRYPT:\n{transcript}`,
  },
  podcast: {
    system: `Prowadzisz podcast w stylu Joe Rogana. Mówisz luźno, z autentycznym entuzjazmem, wtrącasz komentarze typu "kurde, to jest niesamowite", "pomyślcie o tym", "serio, to mnie wciągnęło". Dygresje mile widziane. Piszesz jak mówisz — naturalnie, bez formalności. ${ENGLISH_RULE}`,
    user: `Napisz skrypt odcinka podcastu w stylu Joe Rogana. Luźna, wciągająca narracja — jakbyś opowiadał to znajomym przy kawie. Pokaż swój entuzjazm, zadawaj retoryczne pytania, komentuj co cię zaskakuje. Bez formalizmu.\n\nTRANSKRYPT:\n{transcript}`,
  },
};

export type PromptOverrides = Record<string, PromptDef>;

export function readOverrides(): PromptOverrides {
  try {
    return JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf8")) as PromptOverrides;
  } catch {
    return {};
  }
}

export function writeOverride(style: string, def: PromptDef | null): PromptOverrides {
  const cur = readOverrides();
  if (def === null) {
    delete cur[style];
  } else {
    cur[style] = def;
  }
  fs.writeFileSync(PROMPTS_PATH, JSON.stringify(cur, null, 2));
  return cur;
}

/** Zwraca efektywny prompt dla stylu (override lub domyślny) z wstawionym transkryptem. */
export function getPrompt(style: string, transcript: string): { system: string; user: string } {
  const def = readOverrides()[style] ?? DEFAULT_PROMPTS[style] ?? DEFAULT_PROMPTS.encyclopedic!;
  const user = def.user.includes("{transcript}")
    ? def.user.replaceAll("{transcript}", transcript)
    : `${def.user}\n\nTRANSKRYPT:\n${transcript}`;
  return { system: def.system, user };
}

/** Lista stylów + ich efektywne prompty (do edytora), z flagą czy nadpisane. */
export function listPrompts(): Record<string, PromptDef & { isCustom: boolean }> {
  const overrides = readOverrides();
  const out: Record<string, PromptDef & { isCustom: boolean }> = {};
  for (const [id, def] of Object.entries(DEFAULT_PROMPTS)) {
    const ov = overrides[id];
    out[id] = { ...(ov ?? def), isCustom: !!ov };
  }
  return out;
}
