import { cfg, readEnv } from "./env";
import { getActive } from "./provider";

export { cfg, readEnv };

/** Wybrany model LLM (aktywnego providera). */
export function getModel(): string {
  return getActive().model || cfg("LLM_MODEL", "gemini-2.5-flash");
}

/** Wywołanie LLM (OpenAI-compatible chat/completions) na aktywnym providerze. */
export async function callLLM(
  messages: { role: string; content: string }[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const p = getActive();
  const apiUrl = p.baseUrl + "/chat/completions";

  if (!p.baseUrl || !p.apiKey) {
    throw new Error("Provider LLM nie jest skonfigurowany (baseUrl/apiKey)");
  }

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({
      model: p.model,
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 2048,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Zasada fonetyczna do wstrzyknięcia w prompt — angielskie terminy mają być
 * zapisane tak, by polski lektor TTS wymówił je po angielsku.
 */
export const PHONETIC_RULE = `WAŻNE — wymowa: tekst będzie czytany przez polski syntezator mowy. Angielskie nazwy, marki, skróty i terminy techniczne ZAPISZ FONETYCZNIE tak, jak wymówiłby je polski lektor próbujący brzmieć po angielsku. Przykłady:
- "GPU" → "dżi-pi-ju", "CPU" → "si-pi-ju", "API" → "ej-pi-aj", "AI" → "ej-aj", "SQL" → "es-kju-el", "URL" → "ju-ar-el"
- "Docker" → "Doker", "Linux" → "Linuks", "Supabase" → "Supabejs", "PostgreSQL" → "Postgres", "GitHub" → "Githab", "Kubernetes" → "Kubernetis"
- nieznane angielskie słowa zapisz fonetycznie wg angielskiej wymowy zapisanej polskimi literami
Nie tłumacz znaczenia — tylko zapisz fonetycznie, by brzmiało poprawnie po przeczytaniu na głos.`;

/**
 * Przepisuje tekst na wersję mówioną: angielskie terminy fonetycznie po polsku.
 * Używane przed wysłaniem do TTS (wyświetlane podsumowanie pozostaje bez zmian).
 */
export async function phoneticizeForTTS(text: string): Promise<string> {
  try {
    const out = await callLLM(
      [
        {
          role: "system",
          content: `Jesteś korektorem przygotowującym tekst do odczytu przez polski syntezator mowy. ${PHONETIC_RULE} Zwróć WYŁĄCZNIE przepisany tekst, bez komentarzy, bez zmiany treści ani interpunkcji poza zapisem fonetycznym angielskich słów.`,
        },
        { role: "user", content: text },
      ],
      { temperature: 0.2, maxTokens: 3000 },
    );
    const cleaned = out.trim();
    return cleaned.length > 0 ? cleaned : text;
  } catch (e) {
    console.warn("[phoneticize] failed, using raw text:", e);
    return text; // fallback — lepiej oryginał niż brak audio
  }
}
