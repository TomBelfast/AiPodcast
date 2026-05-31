import { NextResponse } from "next/server";
import { getModel, writeLlmSettings } from "../_lib/llm";

export function GET() {
  return NextResponse.json({ model: getModel() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { model?: string };
    const model = (body.model ?? "").trim();
    if (!model) return NextResponse.json({ error: "Podaj model" }, { status: 400 });
    writeLlmSettings({ model });
    return NextResponse.json({ model });
  } catch {
    return NextResponse.json({ error: "Błędne dane" }, { status: 400 });
  }
}
