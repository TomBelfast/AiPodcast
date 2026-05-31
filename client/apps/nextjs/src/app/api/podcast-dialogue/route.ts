import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { db } from "@acme/db/client";
import { summary } from "@acme/db/schema";
import { eq } from "@acme/db";
import { cfg, readEnv, PHONETIC_RULE } from "../_lib/llm";

function getTtsUrl() {
  return process.env.TTS_SERVER_URL || readEnv().TTS_SERVER_URL || "http://localhost:8765";
}

const DIALOGUE_SYSTEM = `Jesteś scenarzystą podcastów. Tworzysz naturalne, wciągające dialogi po polsku między dwójką prowadzących:
- Ania: entuzjastyczna, opowiada anegdoty, odnosi do codziennego życia, czasem przerywa z podekscytowaniem
- Marek: analityczny, zadaje pytania wyjaśniające, robi odniesienia do popkultury, czasem kończy zdania Ani

Zasady:
1. Dialogi mają brzmieć naturalnie — używaj "no właśnie", "wiesz co", "dokładnie", "serio?", "kurde"
2. Format WYŁĄCZNIE: "Ania: tekst" lub "Marek: tekst" — każda kwestia w nowej linii
3. Minimum 8, maksimum 20 wymian
4. Zacznij od Ani witającej słuchaczy i zapowiadającej temat

${PHONETIC_RULE}`;

const DIALOGUE_USER = (summaryText: string) => `Na podstawie poniższego podsumowania utwórz skrypt podcastu jako dialog Ani i Marka.
Zachowaj wszystkie ważne informacje z podsumowania — zamień je w naturalną rozmowę.

PODSUMOWANIE:
${summaryText}`;

interface Segment { speaker: string; text: string; }

function parseDialogue(raw: string): Segment[] {
  return raw
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const m = l.match(/^(Ania|Marek)\s*:\s*(.+)$/i);
      if (!m) return null;
      return { speaker: m[1]!.toLowerCase(), text: m[2]!.trim() };
    })
    .filter((s): s is Segment => s !== null);
}

async function generateDialogueScript(summaryText: string): Promise<Segment[]> {
  const apiUrl = cfg("LLM_API_URL") + "/chat/completions";
  const apiKey = cfg("LLM_API_KEY");
  const model  = cfg("LLM_MODEL", "gemini-2.5-flash");

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: DIALOGUE_SYSTEM },
        { role: "user",   content: DIALOGUE_USER(summaryText) },
      ],
      temperature: 0.75,
      max_tokens: 3000,
    }),
  });

  if (!res.ok) throw new Error(`LLM error ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content ?? "";
  const segments = parseDialogue(raw);
  if (segments.length < 2) throw new Error(`Za mało linii dialogu (${segments.length}). Raw:\n${raw.slice(0, 300)}`);
  return segments;
}

const PODCASTS_DIR = "/app/podcasts";

async function generateDialogueAudio(segments: Segment[]): Promise<Buffer> {
  const res = await fetch(`${getTtsUrl()}/podcast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      segments,
      voices: { ania: "F1", marek: "M1" },
    }),
  });
  if (!res.ok) {
    const e = await res.text();
    throw new Error(`TTS /podcast error ${res.status}: ${e.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function POST(req: Request) {
  let summaryText: string, summaryId: string | undefined;
  try {
    const body = (await req.json()) as { summaryText?: string; summaryId?: string };
    summaryText = (body.summaryText ?? "").trim();
    summaryId = body.summaryId;
    if (!summaryText) throw new Error("brak summaryText");
  } catch {
    return NextResponse.json({ error: "Podaj summaryText" }, { status: 400 });
  }

  // fire & forget — natychmiast odpowiadamy, generowanie w tle
  void (async () => {
    try {
      console.log("[dialogue] generating script…");
      const segments = await generateDialogueScript(summaryText);
      console.log(`[dialogue] ${segments.length} segments, generating audio…`);
      const audio = await generateDialogueAudio(segments);
      if (summaryId) {
        if (!fs.existsSync(PODCASTS_DIR)) fs.mkdirSync(PODCASTS_DIR, { recursive: true });
        const filename = `dialogue_${summaryId}.wav`;
        fs.writeFileSync(path.join(PODCASTS_DIR, filename), audio);
        await db.update(summary)
          .set({ podcastPath: `/api/podcast/${filename}` })
          .where(eq(summary.id, summaryId));
        console.log(`[dialogue] saved ${filename}`);
      }
    } catch (err) {
      console.error("[dialogue] failed:", err);
    }
  })();

  return NextResponse.json({ status: "generating" });
}
