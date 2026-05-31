import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { db } from "@acme/db/client";
import { summary } from "@acme/db/schema";
import { eq } from "@acme/db";
import { phoneticizeForTTS } from "../_lib/llm";
import { readSettings } from "../_lib/settings";

function getTtsUrl(): string {
  if (process.env.TTS_SERVER_URL) return process.env.TTS_SERVER_URL;
  try {
    const p = path.resolve(process.cwd(), "../../.env");
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^TTS_SERVER_URL=['"]?(.+?)['"]?\s*$/);
      if (m) return m[1]!;
    }
  } catch {}
  return "http://localhost:8765";
}

const PODCASTS_DIR = "/app/podcasts";

function ensurePodcastsDir() {
  if (!fs.existsSync(PODCASTS_DIR)) fs.mkdirSync(PODCASTS_DIR, { recursive: true });
}

// Generuje audio w tle — niezależnie od połączenia z przeglądarką.
// Zapis pliku i aktualizacja bazy następuje po zakończeniu generowania.
async function generateInBackground(text: string, gender: "female" | "male", summaryId: string | undefined) {
  try {
    // fonetyzacja angielskich terminów dla poprawnej wymowy w TTS
    const spoken = await phoneticizeForTTS(text);

    // preset głosu wg płci z zapisanych ustawień (głos + tempo + jakość)
    const s = readSettings();
    const preset = gender === "male" ? s.male : s.female;

    const res = await fetch(`${getTtsUrl()}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: spoken, voice: preset.voice, speed: preset.speed, steps: preset.steps, lang: "na" }),
      // brak signal — generowanie nie zostanie przerwane nawet jeśli
      // klient rozłączy się lub zmieni stronę
    });

    if (!res.ok) {
      console.error("[tts bg] TTS error:", res.status);
      return;
    }

    const audio = Buffer.from(await res.arrayBuffer());

    if (summaryId) {
      ensurePodcastsDir();
      const filename = `podcast_${summaryId}.wav`;
      const filepath = path.join(PODCASTS_DIR, filename);
      fs.writeFileSync(filepath, audio);
      await db.update(summary)
        .set({ podcastPath: `/api/podcast/${filename}` })
        .where(eq(summary.id, summaryId));
      console.log(`[tts bg] saved ${filepath}`);
    }
  } catch (err) {
    console.error("[tts bg] failed:", err);
  }
}

export async function POST(req: Request) {
  let text: string, gender: "female" | "male", summaryId: string | undefined;
  try {
    const body = (await req.json()) as { text?: string; gender?: string; summaryId?: string };
    text = (body.text ?? "").trim();
    gender = body.gender === "male" ? "male" : "female";
    summaryId = body.summaryId;
    if (!text) throw new Error("brak tekstu");
  } catch {
    return NextResponse.json({ error: "Podaj tekst do syntezy" }, { status: 400 });
  }

  // Odpal w tle i natychmiast odpowiedz — nawigacja nie przerwie generowania
  void generateInBackground(text, gender, summaryId);

  return NextResponse.json({ status: "generating" });
}
