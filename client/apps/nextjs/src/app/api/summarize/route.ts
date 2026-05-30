import fs from "fs";
import path from "path";
import { YoutubeTranscript } from "youtube-transcript";
import { NextResponse } from "next/server";
import { db } from "@acme/db/client";
import { summary } from "@acme/db/schema";

function readEnv(): Record<string, string> {
  try {
    const p = path.resolve(process.cwd(), "../../.env");
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=['"]?(.+?)['"]?\s*$/);
      if (m) out[m[1]!] = m[2]!;
    }
    return out;
  } catch { return {}; }
}

function cfg(key: string, fallback = ""): string {
  return process.env[key] || readEnv()[key] || fallback;
}

async function fetchTranscript(videoUrl: string): Promise<{ text: string; title: string }> {
  const items = await YoutubeTranscript.fetchTranscript(videoUrl, { lang: "pl" })
    .catch(() => YoutubeTranscript.fetchTranscript(videoUrl));
  const text = items.map((i) => i.text).join(" ");
  // próba wyciągnięcia tytułu z URL jako fallback
  const videoId = videoUrl.match(/[?&]v=([^&]+)/)?.[1] ?? videoUrl;
  return { text, title: videoId };
}

async function callLLM(transcript: string): Promise<string> {
  const apiUrl = cfg("LLM_API_URL") + "/chat/completions";
  const apiKey = cfg("LLM_API_KEY");
  const model  = cfg("LLM_MODEL", "gemini-2.5-flash");

  if (!cfg("LLM_API_URL") || !apiKey) {
    throw new Error("LLM_API_URL i LLM_API_KEY muszą być skonfigurowane w .env");
  }

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `Jesteś redaktorem encyklopedycznym piszącym po polsku w stylu Wikipedii. Twoje zasady:
1. Piszesz jasno, zwięźle i neutralnie — tak aby osoba bez wiedzy technicznej rozumiała każde zdanie.
2. Nazwy własne, marki, technologie i terminy techniczne ZAWSZE zostawiasz w oryginalnej angielskiej formie (np. "Proxmox", "load balancing", "GPU", "Docker", "API"). Nigdy ich nie tłumaczysz ani nie przekształcasz fonetycznie.
3. Piszesz pełnymi zdaniami, bez list i punktorów — styl narracyjny nadający się do czytania na głos.
4. Unikasz żargonu — gdy musisz użyć pojęcia technicznego, w nawiasie dodajesz krótkie wyjaśnienie po polsku.`,
        },
        {
          role: "user",
          content: `Napisz szczegółowe podsumowanie poniższego transkryptu w języku polskim, w stylu artykułu encyklopedycznego.

Struktura:
- Zacznij od jednego zdania wyjaśniającego o czym jest materiał i dlaczego jest istotny.
- Następnie omów kolejne zagadnienia w logicznej kolejności — każde w osobnym akapicie.
- Zakończ wnioskami lub praktycznym znaczeniem omawianych treści.

Pamiętaj: nazwy angielskie (produkty, technologie, firmy, funkcje) zostaw dokładnie tak jak są w transkrypcie — nie tłumacz ich na polski.

TRANSKRYPT:
${transcript}`,
        },
      ],
      temperature: 0.4,
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

export async function POST(req: Request) {
  let videoUrl: string;
  try {
    const body = (await req.json()) as { url?: string };
    videoUrl = (body.url ?? "").trim();
    if (!videoUrl) throw new Error("brak url");
  } catch {
    return NextResponse.json({ error: "Podaj URL do YouTube" }, { status: 400 });
  }

  try {
    const { text: transcript, title } = await fetchTranscript(videoUrl);
    if (!transcript) {
      return NextResponse.json({ error: "Nie można pobrać transkryptu z tego wideo" }, { status: 422 });
    }

    const summaryText = await callLLM(transcript);
    if (!summaryText) {
      return NextResponse.json({ error: "LLM nie zwróciło treści" }, { status: 502 });
    }

    const [saved] = await db.insert(summary).values({
      youtubeUrl: videoUrl,
      title,
      transcript,
      summaryText,
    }).returning({ id: summary.id });

    return NextResponse.json({ summary: summaryText, id: saved?.id });
  } catch (err) {
    console.error("[summarize]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
