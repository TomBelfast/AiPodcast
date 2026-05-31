import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { db } from "@acme/db/client";
import { summary } from "@acme/db/schema";
import { desc, inArray } from "@acme/db";

const PODCASTS_DIR = "/app/podcasts";

export async function GET() {
  try {
    const rows = await db
      .select({
        id: summary.id,
        youtubeUrl: summary.youtubeUrl,
        title: summary.title,
        summaryText: summary.summaryText,
        transcript: summary.transcript,
        podcastPath: summary.podcastPath,
        summaryStyle: summary.summaryStyle,
        createdAt: summary.createdAt,
      })
      .from(summary)
      .orderBy(desc(summary.createdAt))
      .limit(50);
    return NextResponse.json({ history: rows });
  } catch (err) {
    console.error("[history]", err);
    return NextResponse.json({ history: [] });
  }
}

// Usuwa rekordy (+ pliki audio) dla podanych id.
export async function DELETE(req: Request) {
  let ids: string[];
  try {
    const body = (await req.json()) as { ids?: string[] };
    ids = (body.ids ?? []).filter((x) => typeof x === "string" && x.length > 0);
    if (ids.length === 0) throw new Error("brak id");
  } catch {
    return NextResponse.json({ error: "Podaj ids" }, { status: 400 });
  }

  try {
    // pobierz ścieżki audio do usunięcia plików
    const rows = await db
      .select({ id: summary.id, podcastPath: summary.podcastPath })
      .from(summary)
      .where(inArray(summary.id, ids));

    await db.delete(summary).where(inArray(summary.id, ids));

    // usuń pliki audio (z podcastPath + warianty .wav/.mp3)
    for (const r of rows) {
      const base = r.podcastPath?.split("/").pop();
      const candidates = new Set<string>();
      if (base) candidates.add(base);
      for (const ext of ["wav", "mp3"]) {
        candidates.add(`podcast_${r.id}.${ext}`);
        candidates.add(`dialogue_${r.id}.${ext}`);
      }
      for (const name of candidates) {
        if (name.includes("..")) continue;
        try { fs.unlinkSync(path.join(PODCASTS_DIR, name)); } catch {}
      }
    }

    return NextResponse.json({ deleted: rows.length });
  } catch (err) {
    console.error("[history delete]", err);
    return NextResponse.json({ error: "Błąd usuwania" }, { status: 500 });
  }
}
