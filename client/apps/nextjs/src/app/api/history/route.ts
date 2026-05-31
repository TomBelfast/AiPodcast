import { NextResponse } from "next/server";
import { db } from "@acme/db/client";
import { summary } from "@acme/db/schema";
import { desc } from "@acme/db";

export async function GET() {
  try {
    const rows = await db
      .select({
        id: summary.id,
        youtubeUrl: summary.youtubeUrl,
        title: summary.title,
        summaryText: summary.summaryText,
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
