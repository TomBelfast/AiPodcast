"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const STYLES = [
  { id: "encyclopedic", label: "📖 Wikipedia",       desc: "Encyklopedyczny, szczegółowy" },
  { id: "short",        label: "⚡ Bardzo krótkie",  desc: "Maks 5 zdań, tylko esencja" },
  { id: "simple",       label: "👶 Dla laika",        desc: "Bez żargonu, z analogiami" },
  { id: "tv",           label: "📺 Wiadomości TV",   desc: "Dziennikarski, neutralny" },
  { id: "podcast",      label: "😎 Gawęda (Rogan)",  desc: "Luźny, entuzjastyczny monolog" },
] as const;

type StyleId = typeof STYLES[number]["id"];

function styleLabel(id: string) {
  return STYLES.find(s => s.id === id)?.label ?? id;
}

type SummaryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; text: string; id?: string; title?: string; youtubeUrl?: string; summaryStyle?: string }
  | { status: "error"; message: string };

type PodcastState =
  | { status: "idle" }
  | { status: "loading"; message: string; elapsed?: number; device?: string; logs: string[] }
  | { status: "done"; url: string }
  | { status: "error"; message: string };

interface HistoryItem {
  id: string;
  youtubeUrl: string;
  title: string;
  summaryText: string;
  podcastPath: string | null;
  summaryStyle: string;
  createdAt: string;
}

export default function SummarizePage() {
  const [url, setUrl] = useState("");
  const [voice, setVoice] = useState("F1");
  const [summaryStyle, setSummaryStyle] = useState<StyleId>("encyclopedic");
  const [summary, setSummary] = useState<SummaryState>({ status: "idle" });
  const [podcast, setPodcast] = useState<PodcastState>({ status: "idle" });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // token anulowania aktywnego pollera (zamiast setInterval — jeden, kontrolowany)
  const pollRef = useRef<{ cancelled: boolean } | null>(null);

  useEffect(() => { void loadHistory(); }, []);

  const cancelPoll = useCallback(() => {
    if (pollRef.current) pollRef.current.cancelled = true;
    pollRef.current = null;
  }, []);

  type TtsStatus = {
    state: string; message: string; elapsed_s: number | null;
    device: string; logs: string[]; completions: number;
  };
  async function getStatus(): Promise<TtsStatus> {
    return fetch("/api/tts-status", { cache: "no-store" }).then(r => r.json());
  }

  // Jednolity poller: czeka aż licznik `completions` w TTS wzrośnie (pewny
  // sygnał ukończenia, odporny na fazę LLM i race condition), w międzyczasie
  // pokazuje na żywo status z serwera, a po ukończeniu pobiera plik z historii.
  async function runGeneration(opts: {
    id?: string;
    waitMsg: string;
    fire: () => Promise<void>;
  }) {
    cancelPoll();
    const token = { cancelled: false };
    pollRef.current = token;

    setPodcast({ status: "loading", message: opts.waitMsg, logs: [] });

    // snapshot licznika PRZED uruchomieniem generowania
    let startCompletions = 0;
    try { startCompletions = (await getStatus()).completions ?? 0; } catch {}

    try {
      await opts.fire();
    } catch (err) {
      if (!token.cancelled) setPodcast({ status: "error", message: String(err) });
      return;
    }

    const startedAt = Date.now();
    for (let i = 0; i < 1200; i++) {            // do ~30 min @1.5s
      if (token.cancelled) return;
      await new Promise(r => setTimeout(r, 1500));
      if (token.cancelled) return;

      let s: TtsStatus;
      try { s = await getStatus(); } catch { continue; }

      const completed = (s.completions ?? 0) > startCompletions;

      setPodcast(prev => prev.status === "loading"
        ? {
            status: "loading",
            message: s.state === "idle" && !completed ? opts.waitMsg : s.message,
            elapsed: s.elapsed_s ?? Math.round((Date.now() - startedAt) / 1000),
            device: s.device,
            logs: s.logs ?? [],
          }
        : prev);

      if (!completed) continue;

      // TTS skończył — poczekaj aż plik trafi do historii (zapis DB w tle)
      for (let j = 0; j < 12; j++) {
        if (token.cancelled) return;
        try {
          const hist = await fetch("/api/history", { cache: "no-store" }).then(r => r.json()) as { history: HistoryItem[] };
          const item = opts.id ? hist.history.find(h => h.id === opts.id) : hist.history[0];
          if (item?.podcastPath) {
            setHistory(hist.history);
            // ?t= wymusza świeży plik nawet przy tej samej nazwie
            setPodcast({ status: "done", url: `${item.podcastPath}?t=${Date.now()}` });
            return;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 600));
      }
      setPodcast({ status: "error", message: "Audio gotowe, ale nie zapisano w historii" });
      return;
    }
    if (!token.cancelled) setPodcast({ status: "error", message: "Przekroczono czas oczekiwania" });
  }

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
    cancelPoll();
    setSummary({ status: "loading" });
    setPodcast({ status: "idle" });
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), summaryStyle }),
      });
      const data = (await res.json()) as { summary?: string; id?: string; title?: string; youtubeUrl?: string; error?: string };
      if (!res.ok || data.error) {
        setSummary({ status: "error", message: data.error ?? "Nieznany błąd" });
      } else {
        setSummary({ status: "done", text: data.summary ?? "", id: data.id, title: data.title, youtubeUrl: data.youtubeUrl, summaryStyle: data.summaryStyle });
        void loadHistory();
      }
    } catch (err) {
      setSummary({ status: "error", message: String(err) });
    }
  }

  async function handleGeneratePodcast(text: string, id?: string) {
    await runGeneration({
      id,
      waitMsg: "Przygotowanie syntezy mowy…",
      fire: async () => {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice, summaryId: id }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(e.error ?? "Błąd TTS");
        }
      },
    });
  }

  async function handleGenerateDialogue(text: string, id?: string) {
    await runGeneration({
      id,
      waitMsg: "LLM pisze skrypt dialogu (Ania + Marek)…",
      fire: async () => {
        const res = await fetch("/api/podcast-dialogue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summaryText: text, summaryId: id }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(e.error ?? "Błąd");
        }
      },
    });
  }

  function loadFromHistory(item: HistoryItem) {
    cancelPoll();
    setUrl(item.youtubeUrl);
    setSummaryStyle((item.summaryStyle as StyleId) ?? "encyclopedic");
    setSummary({ status: "done", text: item.summaryText, id: item.id, title: item.title, youtubeUrl: item.youtubeUrl, summaryStyle: item.summaryStyle });
    if (item.podcastPath) {
      setPodcast({ status: "done", url: item.podcastPath });
    } else {
      setPodcast({ status: "idle" });
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const activeSummary = summary.status === "done" ? summary : null;

  // Jeśli oglądane podsumowanie ma już zapisane audio (a poll zginął przy
  // nawigacji/odświeżeniu) — pokaż player automatycznie.
  useEffect(() => {
    if (summary.status !== "done" || !summary.id) return;
    if (podcast.status === "loading" || podcast.status === "done") return;
    const h = history.find(x => x.id === summary.id);
    if (h?.podcastPath) setPodcast({ status: "done", url: h.podcastPath });
  }, [summary, history, podcast.status]);

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
                  <p className="text-xs font-medium text-foreground line-clamp-2 leading-snug">
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                    <span>{formatDate(item.createdAt)}</span>
                    <span>{styleLabel(item.summaryStyle)}</span>
                    {item.podcastPath && <span>🎙</span>}
                  </p>
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

          {/* Styl podsumowania */}
          <div className="flex flex-wrap gap-2">
            {STYLES.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSummaryStyle(s.id)}
                title={s.desc}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  summaryStyle === s.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-input hover:bg-muted"
                }`}
              >
                {s.label}
              </button>
            ))}
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
              suppressHydrationWarning
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
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    {activeSummary.title && (
                      <p className="text-xs text-muted-foreground mb-1">{activeSummary.title}</p>
                    )}
                    <h2 className="text-lg font-semibold">Podsumowanie</h2>
                  </div>
                  {activeSummary.youtubeUrl && (
                    <a
                      href={activeSummary.youtubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                    >
                      ▶ Źródło
                    </a>
                  )}
                </div>
                <div className="text-muted-foreground whitespace-pre-wrap text-sm leading-7">
                  {activeSummary.text}
                </div>
              </div>

              {/* Generowanie audio (podcast) */}
              <div className="border-t border-border pt-4">
                <p className="text-sm font-semibold mb-1">🔊 Wygeneruj audio z tego podsumowania</p>
                <p className="text-xs text-muted-foreground mb-3">
                  Powyższy tekst zamienimy na mowę. Wybierz wariant — gotowe audio pojawi się poniżej i w historii (🎙).
                </p>
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
                    {podcast.status === "loading" ? "⏳ Generuję…" : "🎙 Monolog (1 głos)"}
                  </button>

                  <button
                    onClick={() => handleGenerateDialogue(activeSummary.text, activeSummary.id)}
                    disabled={podcast.status === "loading"}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {podcast.status === "loading" ? "⏳ Generuję…" : "🎭 Dialog (Ania + Marek)"}
                  </button>
                </div>
              </div>

              {podcast.status === "loading" && (
                <div className="bg-muted rounded-lg border p-4 font-mono text-xs space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground mb-2">
                    <span className="animate-pulse">⚙️</span>
                    <span>{podcast.message}</span>
                    {podcast.elapsed && (
                      <span className="text-muted-foreground ml-auto">{podcast.elapsed}s</span>
                    )}
                    {podcast.device && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${podcast.device === "GPU" ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                        {podcast.device}
                      </span>
                    )}
                  </div>
                  {podcast.logs.map((line, i) => (
                    <div key={i} className="text-muted-foreground">{line}</div>
                  ))}
                </div>
              )}

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
