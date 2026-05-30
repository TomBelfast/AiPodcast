import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { db } from "@acme/db/client";
import { summary } from "@acme/db/schema";
import { eq } from "@acme/db";

const TTS_URL = process.env.TTS_SERVER_URL ?? "http://localhost:8765";
const PODCASTS_DIR = "/app/podcasts";

function ensurePodcastsDir() {
  if (!fs.existsSync(PODCASTS_DIR)) fs.mkdirSync(PODCASTS_DIR, { recursive: true });
}

export async function POST(req: Request) {
  let text: string, voice: string, summaryId: string | undefined;
  try {
    const body = (await req.json()) as { text?: string; voice?: string; summaryId?: string };
    text = (body.text ?? "").trim();
    voice = body.voice ?? "F1";
    summaryId = body.summaryId;
    if (!text) throw new Error("brak tekstu");
  } catch {
    return NextResponse.json({ error: "Podaj tekst do syntezy" }, { status: 400 });
  }

  try {
    const res = await fetch(`${TTS_URL}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, lang: "pl" }),
    });

    if (!res.ok) {
      let errMsg = `TTS HTTP ${res.status}`;
      try { const e = (await res.json()) as { error?: string }; errMsg = e.error ?? errMsg; } catch {}
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }

    const audio = Buffer.from(await res.arrayBuffer());

    // zapisz plik i zaktualizuj rekord w bazie
    if (summaryId) {
      try {
        ensurePodcastsDir();
        const filename = `podcast_${summaryId}.wav`;
        const filepath = path.join(PODCASTS_DIR, filename);
        fs.writeFileSync(filepath, audio);
        await db.update(summary)
          .set({ podcastPath: `/api/podcast/${filename}` })
          .where(eq(summary.id, summaryId));
      } catch (e) {
        console.warn("[tts] could not save podcast file:", e);
      }
    }

    return new Response(audio, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Disposition": "attachment; filename=podcast.wav",
      },
    });
  } catch (err) {
    console.error("[tts] fetch failed:", err);
    return NextResponse.json(
      { error: "Nie można połączyć się z serwerem TTS. Czy jest uruchomiony?" },
      { status: 503 },
    );
  }
}
