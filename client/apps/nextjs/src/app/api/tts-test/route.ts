import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

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

// Synchroniczny test pojedynczego zdania — zwraca WAV od razu, nic nie zapisuje.
export async function POST(req: Request) {
  let text: string, voice: string, speed: number, steps: number;
  try {
    const b = (await req.json()) as { text?: string; voice?: string; speed?: number; steps?: number };
    text = (b.text ?? "").trim();
    voice = b.voice ?? "F1";
    speed = b.speed ?? 1.05;
    steps = b.steps ?? 32;
    if (!text) throw new Error("brak tekstu");
  } catch {
    return NextResponse.json({ error: "Podaj tekst" }, { status: 400 });
  }

  try {
    const res = await fetch(`${getTtsUrl()}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, speed, steps, lang: "na" }),
    });
    if (!res.ok) {
      let msg = `TTS HTTP ${res.status}`;
      try { const e = (await res.json()) as { error?: string }; msg = e.error ?? msg; } catch {}
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    const audio = Buffer.from(await res.arrayBuffer());
    return new Response(audio, { headers: { "Content-Type": "audio/wav" } });
  } catch {
    return NextResponse.json(
      { error: "Brak połączenia z serwerem TTS" },
      { status: 503 },
    );
  }
}
