import { NextResponse } from "next/server";

const TTS_URL = process.env.TTS_SERVER_URL ?? "http://localhost:8765";

export async function POST(req: Request) {
  let text: string, voice: string;
  try {
    const body = (await req.json()) as { text?: string; voice?: string };
    text = (body.text ?? "").trim();
    voice = body.voice ?? "F1";
    if (!text) throw new Error("brak tekstu");
  } catch {
    return NextResponse.json({ error: "Podaj tekst do syntezy" }, { status: 400 });
  }

  try {
    const res = await fetch(`${TTS_URL}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
    });

    if (!res.ok) {
      let errMsg = `TTS HTTP ${res.status}`;
      try {
        const err = (await res.json()) as { error?: string };
        errMsg = err.error ?? errMsg;
      } catch {}
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }

    const audio = await res.arrayBuffer();
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
