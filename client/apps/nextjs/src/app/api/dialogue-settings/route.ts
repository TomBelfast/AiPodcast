import { NextResponse } from "next/server";
import { readDialogue, writeDialogue, DEFAULT_DIALOGUE, type DialogueSettings } from "../_lib/dialogue";

export function GET() {
  return NextResponse.json(readDialogue());
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<DialogueSettings> & { reset?: boolean };
    if (body.reset) {
      writeDialogue(DEFAULT_DIALOGUE);
      return NextResponse.json(DEFAULT_DIALOGUE);
    }
    const cur = readDialogue();
    const next: DialogueSettings = {
      hostA: { ...cur.hostA, ...(body.hostA ?? {}) },
      hostB: { ...cur.hostB, ...(body.hostB ?? {}) },
      minExchanges: typeof body.minExchanges === "number" ? body.minExchanges : cur.minExchanges,
      maxExchanges: typeof body.maxExchanges === "number" ? body.maxExchanges : cur.maxExchanges,
      temperature: typeof body.temperature === "number" ? body.temperature : cur.temperature,
    };
    writeDialogue(next);
    return NextResponse.json(next);
  } catch {
    return NextResponse.json({ error: "Błędne dane" }, { status: 400 });
  }
}
