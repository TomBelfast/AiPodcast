"use client";

import { useRef, useState } from "react";

type SummaryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; text: string }
  | { status: "error"; message: string };

type PodcastState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; url: string }
  | { status: "error"; message: string };

export default function SummarizePage() {
  const [url, setUrl] = useState("");
  const [voice, setVoice] = useState("F1");
  const [summary, setSummary] = useState<SummaryState>({ status: "idle" });
  const [podcast, setPodcast] = useState<PodcastState>({ status: "idle" });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function handleSummarize(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setSummary({ status: "loading" });
    setPodcast({ status: "idle" });
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await res.json()) as { summary?: string; error?: string };
      if (!res.ok || data.error) {
        setSummary({ status: "error", message: data.error ?? "Nieznany błąd" });
      } else {
        setSummary({ status: "done", text: data.summary ?? "" });
      }
    } catch (err) {
      setSummary({ status: "error", message: String(err) });
    }
  }

  async function handleGeneratePodcast() {
    if (summary.status !== "done") return;
    setPodcast({ status: "loading" });
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: summary.text, voice }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setPodcast({ status: "error", message: err.error ?? "Błąd TTS" });
        return;
      }
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      setPodcast({ status: "done", url: audioUrl });
    } catch (err) {
      setPodcast({ status: "error", message: String(err) });
    }
  }

  return (
    <main className="bg-background min-h-screen px-4 py-12">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">OpenBrief — Podsumuj wideo</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Wklej link do YouTube, wygeneruj podsumowanie i podcast.
          </p>
        </div>

        {/* URL input */}
        <form onSubmit={handleSummarize} className="flex gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="border-input bg-background placeholder:text-muted-foreground flex h-10 w-full rounded-md border px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
          <button
            type="submit"
            disabled={summary.status === "loading"}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {summary.status === "loading" ? "Generuję…" : "Podsumuj"}
          </button>
        </form>

        {/* Summary output */}
        {summary.status === "error" && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {summary.message}
          </div>
        )}

        {summary.status === "done" && (
          <div className="space-y-4">
            <div className="bg-card rounded-lg border p-5">
              <h2 className="mb-3 text-lg font-semibold">Podsumowanie</h2>
              <div className="text-muted-foreground whitespace-pre-wrap text-sm leading-7">
                {summary.text}
              </div>
            </div>

            {/* Podcast controls */}
            <div className="flex items-center gap-3">
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                className="border-input bg-background h-10 rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="M1">Głos M1 (mężczyzna)</option>
                <option value="M2">Głos M2 (mężczyzna)</option>
                <option value="F1">Głos F1 (kobieta)</option>
                <option value="F2">Głos F2 (kobieta)</option>
              </select>

              <button
                onClick={handleGeneratePodcast}
                disabled={podcast.status === "loading"}
                className="bg-secondary text-secondary-foreground hover:bg-secondary/80 inline-flex h-10 items-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {podcast.status === "loading" ? "Generuję podcast…" : "🎙 Generuj podcast"}
              </button>
            </div>

            {podcast.status === "error" && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
                {podcast.message}
              </div>
            )}

            {podcast.status === "done" && (
              <div className="bg-card rounded-lg border p-4">
                <p className="mb-2 text-sm font-medium">Podcast gotowy — odsłuchaj lub pobierz:</p>
                <audio
                  ref={audioRef}
                  controls
                  src={podcast.url}
                  className="w-full"
                />
                <a
                  href={podcast.url}
                  download="podcast.wav"
                  className="text-primary mt-2 inline-block text-sm underline underline-offset-2"
                >
                  Pobierz WAV
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
