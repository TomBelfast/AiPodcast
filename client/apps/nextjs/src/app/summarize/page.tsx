"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";

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
  | { status: "done"; text: string; id?: string; title?: string; youtubeUrl?: string; summaryStyle?: string; transcript?: string }
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
  transcript: string;
  podcastPath: string | null;
  summaryStyle: string;
  createdAt: string;
}

export default function SummarizePage() {
  const [url, setUrl] = useState("");
  const [monologGender, setMonologGender] = useState<"female" | "male">("female");
  const [summaryStyle, setSummaryStyle] = useState<StyleId>("encyclopedic");
  const [summary, setSummary] = useState<SummaryState>({ status: "idle" });
  const [podcast, setPodcast] = useState<PodcastState>({ status: "idle" });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // token anulowania aktywnego pollera (zamiast setInterval — jeden, kontrolowany)
  const pollRef = useRef<{ cancelled: boolean } | null>(null);

  // edytor promptów
  const [promptEditor, setPromptEditor] = useState<{
    style: StyleId; system: string; user: string; isCustom: boolean; saving: boolean;
  } | null>(null);

  async function openPromptEditor(style: StyleId) {
    try {
      const { prompts } = await fetch("/api/prompts").then(r => r.json()) as {
        prompts: Record<string, { system: string; user: string; isCustom: boolean }>;
      };
      const p = prompts[style];
      setPromptEditor({ style, system: p?.system ?? "", user: p?.user ?? "", isCustom: p?.isCustom ?? false, saving: false });
    } catch {
      setPromptEditor({ style, system: "", user: "", isCustom: false, saving: false });
    }
  }

  async function savePrompt(reset = false) {
    if (!promptEditor) return;
    setPromptEditor({ ...promptEditor, saving: true });
    try {
      await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reset
          ? { style: promptEditor.style, reset: true }
          : { style: promptEditor.style, system: promptEditor.system, user: promptEditor.user }),
      });
      setPromptEditor(null);
    } catch {
      setPromptEditor({ ...promptEditor, saving: false });
    }
  }

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
      const data = (await res.json()) as { summary?: string; id?: string; title?: string; youtubeUrl?: string; summaryStyle?: string; transcript?: string; error?: string };
      if (!res.ok || data.error) {
        setSummary({ status: "error", message: data.error ?? "Nieznany błąd" });
      } else {
        setSummary({ status: "done", text: data.summary ?? "", id: data.id, title: data.title, youtubeUrl: data.youtubeUrl, summaryStyle: data.summaryStyle, transcript: data.transcript });
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
          body: JSON.stringify({ text, gender: monologGender, summaryId: id }),
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
    setSummary({ status: "done", text: item.summaryText, id: item.id, title: item.title, youtubeUrl: item.youtubeUrl, summaryStyle: item.summaryStyle, transcript: item.transcript });
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
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">OpenBrief — Podsumuj wideo</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Wklej link do YouTube, wygeneruj podsumowanie i podcast.
              </p>
            </div>
            <Link
              href="/playground"
              className="shrink-0 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              🎚 Playground głosów
            </Link>
          </div>

          {/* Styl podsumowania */}
          <div className="flex flex-wrap gap-2">
            {STYLES.map(s => (
              <div
                key={s.id}
                title={s.desc}
                className={`group inline-flex items-center rounded-full border text-sm font-medium transition-colors ${
                  summaryStyle === s.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-input hover:bg-muted"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSummaryStyle(s.id)}
                  className="pl-3 pr-2 py-1.5"
                >
                  {s.label}
                </button>
                <button
                  type="button"
                  onClick={() => openPromptEditor(s.id)}
                  title="Edytuj prompt tego stylu"
                  className={`pr-2.5 pl-1 py-1.5 opacity-60 hover:opacity-100 ${
                    summaryStyle === s.id ? "" : "text-muted-foreground"
                  }`}
                >
                  ⚙️
                </button>
              </div>
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
              {/* 1) Transkrypt — zwinięty domyślnie */}
              {activeSummary.transcript && (
                <details className="bg-card rounded-lg border group">
                  <summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold flex items-center gap-2 list-none">
                    <span className="transition-transform group-open:rotate-90">▶</span>
                    <span>📄 Transkrypt</span>
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      ({activeSummary.transcript.length} znaków — kliknij aby rozwinąć)
                    </span>
                  </summary>
                  <div className="px-5 pb-5 max-h-96 overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-muted-foreground border-t border-border pt-3">
                    {activeSummary.transcript}
                  </div>
                </details>
              )}

              {/* 2) Podsumowanie */}
              <div className="bg-card rounded-lg border p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    {activeSummary.title && (
                      <p className="text-xs text-muted-foreground mb-1">{activeSummary.title}</p>
                    )}
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      📝 Podsumowanie
                      <span className="text-xs font-normal text-muted-foreground">
                        {styleLabel(activeSummary.summaryStyle ?? "encyclopedic")}
                      </span>
                    </h2>
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

              {/* 3) Podcast */}
              <div className="bg-card rounded-lg border p-5">
                <p className="text-lg font-semibold mb-1">🔊 Podcast</p>
                <p className="text-xs text-muted-foreground mb-3">
                  Zamień powyższe podsumowanie na mowę. Głosy i parametry ustawisz w{" "}
                  <Link href="/playground" className="text-primary underline underline-offset-2">Playground</Link>.
                  Gotowe audio pojawi się poniżej i w historii (🎙).
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="inline-flex rounded-md border overflow-hidden">
                    <button
                      onClick={() => setMonologGender("female")}
                      className={`px-3 h-10 text-sm font-medium transition-colors ${monologGender === "female" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                    >
                      👩 Kobiecy
                    </button>
                    <button
                      onClick={() => setMonologGender("male")}
                      className={`px-3 h-10 text-sm font-medium transition-colors border-l ${monologGender === "male" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                    >
                      👨 Męski
                    </button>
                  </div>

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

      {/* Modal edycji promptu */}
      {promptEditor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !promptEditor.saving && setPromptEditor(null)}
        >
          <div
            className="bg-background rounded-lg border shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                Edytuj prompt — {styleLabel(promptEditor.style)}
                {promptEditor.isCustom && (
                  <span className="ml-2 text-xs text-amber-500">● zmodyfikowany</span>
                )}
              </h3>
              <button onClick={() => setPromptEditor(null)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">System prompt (rola / styl)</label>
              <textarea
                value={promptEditor.system}
                onChange={(e) => setPromptEditor({ ...promptEditor, system: e.target.value })}
                rows={5}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">
                User prompt (instrukcja) — użyj <code className="bg-muted px-1 rounded">{"{transcript}"}</code> jako miejsce na transkrypt
              </label>
              <textarea
                value={promptEditor.user}
                onChange={(e) => setPromptEditor({ ...promptEditor, user: e.target.value })}
                rows={7}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Jeśli pominiesz {"{transcript}"}, transkrypt zostanie dopisany automatycznie na końcu.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                onClick={() => savePrompt(true)}
                disabled={promptEditor.saving}
                className="text-sm text-muted-foreground hover:text-destructive underline underline-offset-2 disabled:opacity-50"
              >
                Przywróć domyślny
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setPromptEditor(null)}
                  disabled={promptEditor.saving}
                  className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  Anuluj
                </button>
                <button
                  onClick={() => savePrompt(false)}
                  disabled={promptEditor.saving}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center rounded-md px-4 text-sm font-medium disabled:opacity-50"
                >
                  {promptEditor.saving ? "Zapisuję…" : "💾 Zapisz"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
