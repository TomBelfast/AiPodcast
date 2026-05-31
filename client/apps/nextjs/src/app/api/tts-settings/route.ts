import { NextResponse } from "next/server";
import { readSettings, writeSettings, DEFAULT_SETTINGS, type TtsSettings } from "../_lib/settings";

export function GET() {
  return NextResponse.json(readSettings());
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<TtsSettings>;
    const cur = readSettings();
    const next: TtsSettings = {
      female: { ...cur.female, ...(body.female ?? {}) },
      male: { ...cur.male, ...(body.male ?? {}) },
      pause: typeof body.pause === "number" ? body.pause : cur.pause,
    };
    writeSettings(next);
    return NextResponse.json(next);
  } catch {
    return NextResponse.json(DEFAULT_SETTINGS, { status: 400 });
  }
}
