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

export async function GET() {
  try {
    const res = await fetch(`${getTtsUrl()}/status`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ state: "unknown", message: "Brak połączenia z TTS" });
  }
}
