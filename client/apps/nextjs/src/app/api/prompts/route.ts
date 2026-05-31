import { NextResponse } from "next/server";
import { listPrompts, writeOverride, DEFAULT_PROMPTS } from "../_lib/prompts";

export function GET() {
  return NextResponse.json({ prompts: listPrompts() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      style?: string;
      system?: string;
      user?: string;
      reset?: boolean;
    };
    const style = body.style ?? "";
    if (!DEFAULT_PROMPTS[style]) {
      return NextResponse.json({ error: "Nieznany styl" }, { status: 400 });
    }
    if (body.reset) {
      writeOverride(style, null); // przywróć domyślny
    } else {
      const system = (body.system ?? "").trim();
      const user = (body.user ?? "").trim();
      if (!system || !user) {
        return NextResponse.json({ error: "System i user nie mogą być puste" }, { status: 400 });
      }
      writeOverride(style, { system, user });
    }
    return NextResponse.json({ prompts: listPrompts() });
  } catch {
    return NextResponse.json({ error: "Błędne dane" }, { status: 400 });
  }
}
