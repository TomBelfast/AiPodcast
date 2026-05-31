import { NextResponse } from "next/server";
import { readProviders, writeProviders, getActive } from "../_lib/provider";

export function GET() {
  return NextResponse.json({ model: getActive().model });
}

// Zapisuje wybrany model dla AKTYWNEGO providera.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { model?: string };
    const model = (body.model ?? "").trim();
    if (!model) return NextResponse.json({ error: "Podaj model" }, { status: 400 });
    const s = readProviders();
    s.providers[s.active]!.model = model;
    writeProviders(s);
    return NextResponse.json({ model });
  } catch {
    return NextResponse.json({ error: "Błędne dane" }, { status: 400 });
  }
}
