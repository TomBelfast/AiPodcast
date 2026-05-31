import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { db } from "@acme/db/client";
import { summary } from "@acme/db/schema";
import { eq } from "@acme/db";
import { cfg, readEnv, getModel } from "../_lib/llm";
import { readSettings } from "../_lib/settings";
import { buildDialoguePrompt, readDialogue, type Host } from "../_lib/dialogue";
import { wavToMp3 } from "../_lib/audio";

function getTtsUrl() {
  return process.env.TTS_SERVER_URL || readEnv().TTS_SERVER_URL || "http://localhost:8765";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Segment { speaker: string; text: string; }

function parseDialogue(raw: string, hostA: Host, hostB: Host): Segment[] {
  const re = new RegExp(`^(${escapeRegex(hostA.name)}|${escapeRegex(hostB.name)})\\s*:\\s*(.+)$`, "i");
  return raw
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const m = l.match(re);
      if (!m) return null;
      return { speaker: m[1]!.toLowerCase(), text: m[2]!.trim() };
    })
    .filter((s): s is Segment => s !== null);
}

async function generateDialogueScript(summaryText: string): Promise<Segment[]> {
  const apiUrl = cfg("LLM_API_URL") + "/chat/completions";
  const apiKey = cfg("LLM_API_KEY");
  const model  = getModel();
  const d = readDialogue();
  const { system, user, hostA, hostB } = buildDialoguePrompt(summaryText);

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user },
      ],
      temperature: d.temperature,
      max_tokens: 3000,
    }),
  });

  if (!res.ok) throw new Error(`LLM error ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content ?? "";
  const segments = parseDialogue(raw, hostA, hostB);
  if (segments.length < 2) throw new Error(`Za mało linii dialogu (${segments.length}). Raw:\n${raw.slice(0, 300)}`);
  return segments;
}

const PODCASTS_DIR = "/app/podcasts";

async function generateDialogueAudio(segments: Segment[]): Promise<Buffer> {
  const s = readSettings();
  const d = readDialogue();
  // host A/B → preset głosu wg płci (female/male) z tts-settings
  const presetFor = (g: "female" | "male") => (g === "male" ? s.male : s.female);
  const res = await fetch(`${getTtsUrl()}/podcast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      segments,
      voices: {
        [d.hostA.name.toLowerCase()]: presetFor(d.hostA.gender),
        [d.hostB.name.toLowerCase()]: presetFor(d.hostB.gender),
      },
      silence: s.pause,
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
      const wav = await generateDialogueAudio(segments);
      const mp3 = await wavToMp3(wav).catch((e) => {
        console.warn("[dialogue] mp3 conversion failed, falling back to wav:", e);
        return null;
      });
      if (summaryId) {
        if (!fs.existsSync(PODCASTS_DIR)) fs.mkdirSync(PODCASTS_DIR, { recursive: true });
        const ext = mp3 ? "mp3" : "wav";
        const filename = `dialogue_${summaryId}.${ext}`;
        fs.writeFileSync(path.join(PODCASTS_DIR, filename), mp3 ?? wav);
        await db.update(summary)
          .set({ podcastPath: `/api/podcast/${filename}` })
          .where(eq(summary.id, summaryId));
        console.log(`[dialogue] saved ${filename} (${(mp3 ?? wav).length} B)`);
      }
    } catch (err) {
      console.error("[dialogue] failed:", err);
    }
  })();

  return NextResponse.json({ status: "generating" });
}
