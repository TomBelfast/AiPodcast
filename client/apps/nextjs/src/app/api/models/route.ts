import { NextResponse } from "next/server";
import { cfg } from "../_lib/llm";

// Proxy do listy modeli lokalnego API (OpenAI-compatible /models).
export async function GET() {
  const base = cfg("LLM_API_URL");
  const key = cfg("LLM_API_KEY");
  if (!base) return NextResponse.json({ models: [] });
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ models: [] });
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => !!id)
      .sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ models: [] });
  }
}
