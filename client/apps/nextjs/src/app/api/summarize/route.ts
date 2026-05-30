import { NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

export async function POST(req: Request) {
  if (!GEMINI_API_KEY) {
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

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const payload = {
    contents: [
      {
        parts: [
          {
            fileData: {
              mimeType: "video/mp4",
              fileUri: url,
            },
          },
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
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048,
    },
  };

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[summarize] Gemini error:", res.status, errText);
      return NextResponse.json({ error: `Błąd Gemini API: ${res.status}` }, { status: 502 });
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) {
      return NextResponse.json({ error: "Gemini nie zwróciło treści" }, { status: 502 });
    }

    return NextResponse.json({ summary: text });
  } catch (err) {
    console.error("[summarize] fetch failed:", err);
    return NextResponse.json({ error: "Błąd połączenia z Gemini" }, { status: 502 });
  }
}
