import { NextResponse } from "next/server";
import { getActive } from "../_lib/provider";

// Proxy do listy modeli AKTYWNEGO providera (OpenAI-compatible /models).
export async function GET() {
  const p = getActive();
  if (!p.baseUrl) return NextResponse.json({ models: [] });
  try {
    const res = await fetch(`${p.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${p.apiKey}` },
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
