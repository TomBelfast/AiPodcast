import fs from "fs";
import { cfg } from "./env";

const PROVIDERS_PATH = "/app/provider-settings.json";

export interface Provider {
  label: string;
  baseUrl: string; // OpenAI-compatible base (…/v1)
  apiKey: string;
  model: string;   // wybrany model dla tego providera
}

export interface ProviderSettings {
  active: string;                         // id aktywnego providera
  providers: Record<string, Provider>;
}

/** Domyślne ustawienia zalążone z .env (lokalne API). */
function seed(): ProviderSettings {
  return {
    active: "local",
    providers: {
      local: {
        label: "Local (free)",
        baseUrl: cfg("LLM_API_URL", "http://localhost:8420/v1"),
        apiKey: cfg("LLM_API_KEY", ""),
        model: cfg("LLM_MODEL", "gemini-2.5-flash"),
      },
    },
  };
}

export function readProviders(): ProviderSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(PROVIDERS_PATH, "utf8")) as ProviderSettings;
    if (raw && raw.providers && Object.keys(raw.providers).length > 0) {
      if (!raw.providers[raw.active]) raw.active = Object.keys(raw.providers)[0]!;
      return raw;
    }
  } catch {}
  const s = seed();
  try { fs.writeFileSync(PROVIDERS_PATH, JSON.stringify(s, null, 2)); } catch {}
  return s;
}

export function writeProviders(s: ProviderSettings): void {
  fs.writeFileSync(PROVIDERS_PATH, JSON.stringify(s, null, 2));
}

/** Aktywny provider — źródło baseUrl/apiKey/model dla wszystkich wywołań LLM. */
export function getActive(): Provider & { id: string } {
  const s = readProviders();
  const p = s.providers[s.active]!;
  return { id: s.active, ...p };
}
