import { NextResponse } from "next/server";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

// Supports multiple keys separated by commas — falls back on 429
const GEMINI_KEYS = (process.env.GEMINI_API_KEY ?? "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; status: number; body: string };

async function callGemini(key: string, payload: unknown): Promise<GeminiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, body: await res.text() };
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) return { ok: false, status: 502, body: "empty response" };
    return { ok: true, text };
  } catch (err) {
    return { ok: false, status: 503, body: String(err) };
  }
}

export async function POST(req: Request) {
  if (GEMINI_KEYS.length === 0) {
    return NextResponse.json({ error: "GEMINI_API_KEY nie jest skonfigurowany" }, { status: 503 });
  }

  let url: string;
  try {
    const body = (await req.json()) as { url?: string };
    url = (body.url ?? "").trim();
    if (!url) throw new Error("brak url");
  } catch {
    return NextResponse.json({ error: "Podaj URL do YouTube" }, { status: 400 });
  }

  const payload = {
    contents: [
      {
        parts: [
          { fileData: { mimeType: "video/mp4", fileUri: url } },
          {
            text: `Napisz obszerne, szczegółowe podsumowanie tego wideo w języku polskim.

Uwzględnij:
- Główny temat i cel wideo
- Kluczowe punkty i argumenty
- Ważne fakty, liczby, daty (jeśli są)
- Wnioski i podsumowanie końcowe

Pisz płynnym, naturalnym językiem — styl nadający się do czytania lub odsłuchiwania jako podcast.`,
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
  };

  let lastError = "";
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    const key = GEMINI_KEYS[i]!;
    const result = await callGemini(key, payload);
    if (result.ok) {
      if (i > 0) console.log(`[summarize] used key #${i + 1} after ${i} failure(s)`);
      return NextResponse.json({ summary: result.text });
    }
    console.warn(`[summarize] key #${i + 1} failed: HTTP ${result.status}`);
    lastError = `HTTP ${result.status}`;
    // tylko 429 (rate limit) uzasadnia próbę kolejnego klucza
    if (result.status !== 429) break;
  }

  return NextResponse.json({ error: `Błąd Gemini API: ${lastError}` }, { status: 502 });
}
