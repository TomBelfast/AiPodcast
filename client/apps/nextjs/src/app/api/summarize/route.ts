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

async function fetchYoutubeTitle(videoUrl: string): Promise<string> {
  try {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
    const res = await fetch(oembed, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = (await res.json()) as { title?: string };
      if (data.title) return data.title;
    }
  } catch {}
  return videoUrl.match(/[?&]v=([^&]+)/)?.[1] ?? videoUrl;
}

async function fetchTranscript(videoUrl: string): Promise<{ text: string; title: string }> {
  const [items, title] = await Promise.all([
    YoutubeTranscript.fetchTranscript(videoUrl, { lang: "pl" })
      .catch(() => YoutubeTranscript.fetchTranscript(videoUrl)),
    fetchYoutubeTitle(videoUrl),
  ]);
  const text = items.map((i) => i.text).join(" ");
  return { text, title };
}

const ENGLISH_RULE = `Nazwy własne, marki, technologie i terminy techniczne ZAWSZE zostawiasz w oryginalnej angielskiej formie. Nigdy ich nie tłumaczysz ani nie przekształcasz fonetycznie.`;

function buildPrompt(style: string, transcript: string): { system: string; user: string } {
  switch (style) {
    case "short":
      return {
        system: `Piszesz ultraskondensowane podsumowania po polsku. Maksymalnie 5 zdań. Zero lania wody. ${ENGLISH_RULE}`,
        user: `Napisz podsumowanie w MAKSYMALNIE 5 zdaniach. Tylko najważniejsze fakty i wnioski. Żadnych wstępów ani ozdobników.\n\nTRANSKRYPT:\n${transcript}`,
      };
    case "simple":
      return {
        system: `Tłumaczysz skomplikowane tematy prostym językiem — jak dla 12-latka, który nigdy nie słyszał o tej dziedzinie. Używasz analogii z codziennego życia, unikasz żargonu. ${ENGLISH_RULE}`,
        user: `Napisz podsumowanie prostym, przystępnym językiem. Każde pojęcie techniczne wyjaśnij jednym prostym zdaniem lub analogią. Pisz tak, żeby zrozumiała osoba bez żadnego technicznego przygotowania.\n\nTRANSKRYPT:\n${transcript}`,
      };
    case "tv":
      return {
        system: `Jesteś prezenterem wiadomości TVN24. Piszesz zwięźle, neutralnie i rzeczowo. Używasz stylu dziennikarskiego: "Eksperci wskazują…", "Jak podaje…", "Z informacji wynika…". Żadnych opinii, tylko fakty. ${ENGLISH_RULE}`,
        user: `Napisz materiał na wiadomości telewizyjne — 2-3 zwięzłe akapity. Zacznij od najmocniejszego faktu. Styl: neutralny, dziennikarski, bez emocji. Zakończ zdaniem podsumowującym znaczenie tematu.\n\nTRANSKRYPT:\n${transcript}`,
      };
    case "podcast":
      return {
        system: `Prowadzisz podcast w stylu Joe Rogana. Mówisz luźno, z autentycznym entuzjazmem, wtrącasz komentarze typu "kurde, to jest niesamowite", "pomyślcie o tym", "serio, to mnie wciągnęło". Dygresje mile widziane. Piszesz jak mówisz — naturalnie, bez formalności. ${ENGLISH_RULE}`,
        user: `Napisz skrypt odcinka podcastu w stylu Joe Rogana. Luźna, wciągająca narracja — jakbyś opowiadał to znajomym przy kawie. Pokaż swój entuzjazm, zadawaj retoryczne pytania, komentuj co cię zaskakuje. Bez formalizmu.\n\nTRANSKRYPT:\n${transcript}`,
      };
    default: // encyclopedic
      return {
        system: `Jesteś redaktorem encyklopedycznym piszącym po polsku w stylu Wikipedii. Piszesz jasno, zwięźle i neutralnie. Piszesz pełnymi zdaniami, bez list — styl narracyjny nadający się do czytania na głos. Unikasz żargonu — przy pojęciu technicznym dodajesz krótkie wyjaśnienie. ${ENGLISH_RULE}`,
        user: `Napisz szczegółowe podsumowanie w stylu artykułu encyklopedycznego. Zacznij od jednego zdania o czym jest materiał. Omów zagadnienia w logicznej kolejności — każde w osobnym akapicie. Zakończ wnioskami.\n\nTRANSKRYPT:\n${transcript}`,
      };
  }
}

async function callLLM(transcript: string, style: string): Promise<string> {
  const apiUrl = cfg("LLM_API_URL") + "/chat/completions";
  const apiKey = cfg("LLM_API_KEY");
  const model  = cfg("LLM_MODEL", "gemini-2.5-flash");

  if (!cfg("LLM_API_URL") || !apiKey) {
    throw new Error("LLM_API_URL i LLM_API_KEY muszą być skonfigurowane w .env");
  }

  const { system, user } = buildPrompt(style, transcript);

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user },
      ],
      temperature: style === "podcast" ? 0.8 : style === "short" ? 0.2 : 0.4,
      max_tokens: style === "short" ? 512 : 2048,
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
  let videoUrl: string, summaryStyle: string;
  try {
    const body = (await req.json()) as { url?: string; summaryStyle?: string };
    videoUrl = (body.url ?? "").trim();
    summaryStyle = (body.summaryStyle ?? "encyclopedic").trim();
    if (!videoUrl) throw new Error("brak url");
  } catch {
    return NextResponse.json({ error: "Podaj URL do YouTube" }, { status: 400 });
  }

  try {
    const { text: transcript, title } = await fetchTranscript(videoUrl);
    if (!transcript) {
      return NextResponse.json({ error: "Nie można pobrać transkryptu z tego wideo" }, { status: 422 });
    }

    const summaryText = await callLLM(transcript, summaryStyle);
    if (!summaryText) {
      return NextResponse.json({ error: "LLM nie zwróciło treści" }, { status: 502 });
    }

    const [saved] = await db.insert(summary).values({
      youtubeUrl: videoUrl,
      title,
      transcript,
      summaryText,
      summaryStyle,
    }).returning({ id: summary.id });

    return NextResponse.json({ summary: summaryText, id: saved?.id, title, youtubeUrl: videoUrl, summaryStyle });
  } catch (err) {
    console.error("[summarize]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
