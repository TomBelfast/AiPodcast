"use client";

import { useEffect, useRef, useState } from "react";

type SummaryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; text: string; id?: string }
  | { status: "error"; message: string };

type PodcastState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; url: string }
  | { status: "error"; message: string };

interface HistoryItem {
  id: string;
  youtubeUrl: string;
  title: string;
  summaryText: string;
  podcastPath: string | null;
  createdAt: string;
}

export default function SummarizePage() {
  const [url, setUrl] = useState("");
  const [voice, setVoice] = useState("F1");
  const [summary, setSummary] = useState<SummaryState>({ status: "idle" });
  const [podcast, setPodcast] = useState<PodcastState>({ status: "idle" });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => { void loadHistory(); }, []);

  async function loadHistory() {
    try {
      const res = await fetch("/api/history");
      const data = (await res.json()) as { history: HistoryItem[] };
      setHistory(data.history ?? []);
    } catch {}
  }

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
      const data = (await res.json()) as { summary?: string; id?: string; error?: string };
      if (!res.ok || data.error) {
        setSummary({ status: "error", message: data.error ?? "Nieznany błąd" });
      } else {
        setSummary({ status: "done", text: data.summary ?? "", id: data.id });
        void loadHistory();
      }
    } catch (err) {
      setSummary({ status: "error", message: String(err) });
    }
  }

  async function handleGeneratePodcast(text: string, id?: string) {
    setPodcast({ status: "loading" });
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, summaryId: id }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setPodcast({ status: "error", message: err.error ?? "Błąd TTS" });
        return;
      }
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      setPodcast({ status: "done", url: audioUrl });
      void loadHistory();
    } catch (err) {
      setPodcast({ status: "error", message: String(err) });
    }
  }

  function loadFromHistory(item: HistoryItem) {
    setUrl(item.youtubeUrl);
    setSummary({ status: "done", text: item.summaryText, id: item.id });
    if (item.podcastPath) {
      setPodcast({ status: "done", url: item.podcastPath });
    } else {
      setPodcast({ status: "idle" });
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("pl-PL", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  const activeSummary = summary.status === "done" ? summary : null;

  return (
    <div className="bg-background min-h-screen flex">
      {/* Historia — panel lewy */}
      <aside className="w-72 border-r border-border flex-shrink-0 overflow-y-auto hidden md:flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold text-sm">Historia podsumowań</h2>
        </div>
        {history.length === 0 ? (
          <p className="text-muted-foreground text-xs p-4">Brak historii</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => loadFromHistory(item)}
                  className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <p className="text-xs font-medium truncate text-foreground">
                    {item.title || new URL(item.youtubeUrl).searchParams.get("v") || item.youtubeUrl}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(item.createdAt)}
                  </p>
                  {item.podcastPath && (
                    <span className="text-xs text-primary">🎙 podcast</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Główna treść */}
      <main className="flex-1 px-6 py-12 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-8">
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
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {summary.status === "loading" ? "Generuję…" : "Podsumuj"}
            </button>
          </form>

          {summary.status === "error" && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
              {summary.message}
            </div>
          )}

          {activeSummary && (
            <div className="space-y-4">
              <div className="bg-card rounded-lg border p-5">
                <h2 className="mb-3 text-lg font-semibold">Podsumowanie</h2>
                <div className="text-muted-foreground whitespace-pre-wrap text-sm leading-7">
                  {activeSummary.text}
                </div>
              </div>

              {/* Podcast controls */}
              <div className="flex items-center gap-3 flex-wrap">
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
                  onClick={() => handleGeneratePodcast(activeSummary.text, activeSummary.id)}
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
                  <p className="mb-2 text-sm font-medium">Podcast gotowy:</p>
                  <audio ref={audioRef} controls src={podcast.url} className="w-full" />
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
    </div>
  );
}
