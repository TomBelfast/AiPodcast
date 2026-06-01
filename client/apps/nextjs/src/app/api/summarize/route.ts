import fs from "fs";
import path from "path";
import { YoutubeTranscript } from "youtube-transcript";
import { NextResponse } from "next/server";
import { db } from "@acme/db/client";
import { summary } from "@acme/db/schema";
import { getPrompt } from "../_lib/prompts";
import { getActive } from "../_lib/provider";

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

async function fetchYoutubeDescriptionLinks(videoUrl: string): Promise<string[]> {
  try {
    const res = await fetch(videoUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    // YouTube embeds shortDescription in the page JSON — grab the first match
    const match = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/s);
    if (!match?.[1]) return [];

    let description: string;
    try {
      description = JSON.parse('"' + match[1] + '"') as string;
    } catch {
      return [];
    }

    const urlRegex = /https?:\/\/[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_+.~#?&/=]*/g;
    const all = [...new Set(description.match(urlRegex) ?? [])];

    // Filter out self-promotion, social profiles, affiliate and donation links
    const spamPatterns = [
      /youtube\.com\/(channel|c\/|@|subscribe)/i,
      /youtu\.be\//i,
      /twitter\.com\//i,
      /x\.com\//i,
      /instagram\.com\//i,
      /threads\.net\//i,
      /facebook\.com\//i,
      /linkedin\.com\//i,
      /tiktok\.com\//i,
      /buymeacoffee\.com\//i,
      /ko-fi\.com\//i,
      /patreon\.com\//i,
      /amzn\.to\//i,
      /bit\.ly\//i,
      /linktree\./i,
      /linktr\.ee\//i,
      /link\.[a-z]+\.(com|io|ai)\//i,  // link.domain.com redirect services
    ];

    return all.filter(url => !spamPatterns.some(p => p.test(url)));
  } catch {
    return [];
  }
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

async function callLLM(transcript: string, style: string): Promise<string> {
  const p = getActive();
  const apiUrl = p.baseUrl + "/chat/completions";

  if (!p.baseUrl || !p.apiKey) {
    throw new Error("Provider LLM nie jest skonfigurowany");
  }

  const { system, user } = getPrompt(style, transcript);

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${p.apiKey}`,
    },
    body: JSON.stringify({
      model: p.model,
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
    const [{ text: transcript, title }, descriptionLinks] = await Promise.all([
      fetchTranscript(videoUrl),
      fetchYoutubeDescriptionLinks(videoUrl),
    ]);
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
      descriptionLinks: descriptionLinks.length ? descriptionLinks : null,
    }).returning({ id: summary.id });

    return NextResponse.json({ summary: summaryText, id: saved?.id, title, youtubeUrl: videoUrl, summaryStyle, transcript, descriptionLinks });
  } catch (err) {
    console.error("[summarize]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
