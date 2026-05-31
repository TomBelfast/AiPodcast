"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const VOICES = [
  { id: "F1", label: "F1 — kobieta" },
  { id: "F2", label: "F2 — kobieta" },
  { id: "F3", label: "F3 — kobieta" },
  { id: "F4", label: "F4 — kobieta" },
  { id: "F5", label: "F5 — kobieta" },
  { id: "M1", label: "M1 — mężczyzna" },
  { id: "M2", label: "M2 — mężczyzna" },
  { id: "M3", label: "M3 — mężczyzna" },
  { id: "M4", label: "M4 — mężczyzna" },
  { id: "M5", label: "M5 — mężczyzna" },
];

const DEFAULT_TEXT =
  "To jest testowe zdanie. Sprawdzamy jak brzmi ten głos przy danym tempie i jakości. Proksmoks, dżi-pi-ju oraz Doker.";

type GenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; url: string; ms: number }
  | { status: "error"; message: string };

export default function PlaygroundPage() {
  const [text, setText] = useState(DEFAULT_TEXT);
  const [voice, setVoice] = useState("F1");
  const [speed, setSpeed] = useState(1.05);
  const [steps, setSteps] = useState(32);
  const [gen, setGen] = useState<GenState>({ status: "idle" });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // zapisane presety + pauza
  const [saved, setSaved] = useState<{
    female: { voice: string; speed: number; steps: number };
    male: { voice: string; speed: number; steps: number };
    pause: number;
  } | null>(null);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => { void loadSettings(); }, []);

  async function loadSettings() {
    try {
      const s = await fetch("/api/tts-settings").then(r => r.json());
      setSaved(s);
    } catch {}
  }

  async function savePreset(gender: "female" | "male") {
    const body = { [gender]: { voice, speed, steps } };
    try {
      const s = await fetch("/api/tts-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(r => r.json());
      setSaved(s);
      setSavedMsg(`Zapisano jako głos ${gender === "female" ? "kobiecy" : "męski"}: ${voice} · ${speed.toFixed(2)}× · ${steps} kroków`);
      setTimeout(() => setSavedMsg(""), 4000);
    } catch {
      setSavedMsg("Błąd zapisu");
    }
  }

  async function savePause(pause: number) {
    try {
      const s = await fetch("/api/tts-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pause }),
      }).then(r => r.json());
      setSaved(s);
    } catch {}
  }

  async function play() {
    if (!text.trim()) return;
    setGen({ status: "loading" });
    const t0 = performance.now();
    try {
      const res = await fetch("/api/tts-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), voice, speed, steps }),
      });
      if (!res.ok) {
        const e = (await res.json()) as { error?: string };
        setGen({ status: "error", message: e.error ?? "Błąd" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setGen({ status: "done", url, ms: Math.round(performance.now() - t0) });
      // autoplay
      setTimeout(() => { void audioRef.current?.play(); }, 50);
    } catch (err) {
      setGen({ status: "error", message: String(err) });
    }
  }

  return (
    <main className="bg-background min-h-screen px-6 py-12">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">🎚 Playground głosów</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Przetestuj głos, tempo i jakość na jednym zdaniu — usłysz różnicę od razu.
            </p>
          </div>
          <Link href="/summarize" className="text-sm text-primary underline underline-offset-2 shrink-0">
            ← Podsumowania
          </Link>
        </div>

        {/* Tekst testowy */}
        <div>
          <label className="text-sm font-medium mb-1 block">Tekst testowy</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          />
        </div>

        {/* Głos */}
        <div>
          <label className="text-sm font-medium mb-1 block">Głos ({VOICES.length} dostępnych)</label>
          <div className="flex flex-wrap gap-2">
            {VOICES.map((v) => (
              <button
                key={v.id}
                onClick={() => setVoice(v.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  voice === v.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-input hover:bg-muted"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tempo */}
        <div>
          <label className="text-sm font-medium mb-1 flex justify-between">
            <span>Tempo (speed)</span>
            <span className="text-muted-foreground tabular-nums">{speed.toFixed(2)}×</span>
          </label>
          <input
            type="range" min={0.7} max={1.5} step={0.05}
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0.70 wolno</span><span>1.05 dom.</span><span>1.50 szybko</span>
          </div>
        </div>

        {/* Jakość */}
        <div>
          <label className="text-sm font-medium mb-1 flex justify-between">
            <span>Jakość (kroki dyfuzji)</span>
            <span className="text-muted-foreground tabular-nums">{steps} kroków</span>
          </label>
          <input
            type="range" min={8} max={48} step={4}
            value={steps}
            onChange={(e) => setSteps(parseInt(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>8 szybko</span><span>32 dom.</span><span>48 maks.</span>
          </div>
        </div>

        {/* Akcje */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={play}
            disabled={gen.status === "loading"}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-11 items-center rounded-md px-6 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {gen.status === "loading" ? "⏳ Generuję…" : "▶ Odtwórz"}
          </button>
          <span className="text-muted-foreground text-sm">Zapisz obecne ustawienia jako:</span>
          <button
            onClick={() => savePreset("female")}
            className="inline-flex h-11 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted transition-colors"
          >
            💾 👩 Głos kobiecy
          </button>
          <button
            onClick={() => savePreset("male")}
            className="inline-flex h-11 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted transition-colors"
          >
            💾 👨 Głos męski
          </button>
        </div>

        {savedMsg && (
          <div className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
            ✓ {savedMsg}
          </div>
        )}

        {gen.status === "error" && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {gen.message}
          </div>
        )}

        {gen.status === "done" && (
          <div className="bg-card rounded-lg border p-4 space-y-2">
            <p className="text-xs text-muted-foreground">
              {voice} · {speed.toFixed(2)}× · {steps} kroków · wygenerowano w {gen.ms} ms
            </p>
            <audio ref={audioRef} controls src={gen.url} className="w-full" />
          </div>
        )}

        {/* Zapisane ustawienia (używane przy generowaniu podcastu) */}
        {saved && (
          <div className="bg-card rounded-lg border p-4 space-y-3 mt-2">
            <p className="text-sm font-semibold">⚙️ Zapisane ustawienia podcastu</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border p-3">
                <p className="font-medium">👩 Głos kobiecy <span className="text-xs text-muted-foreground">(Ania / monolog kobiecy)</span></p>
                <p className="text-muted-foreground text-xs mt-1">
                  {saved.female.voice} · {saved.female.speed.toFixed(2)}× · {saved.female.steps} kroków
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium">👨 Głos męski <span className="text-xs text-muted-foreground">(Marek / monolog męski)</span></p>
                <p className="text-muted-foreground text-xs mt-1">
                  {saved.male.voice} · {saved.male.speed.toFixed(2)}× · {saved.male.steps} kroków
                </p>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium flex justify-between">
                <span>⏸ Pauza między kwestiami w dialogu</span>
                <span className="text-muted-foreground tabular-nums">{saved.pause.toFixed(1)} s</span>
              </label>
              <input
                type="range" min={0} max={1.5} step={0.1}
                value={saved.pause}
                onChange={(e) => { const p = parseFloat(e.target.value); setSaved({ ...saved, pause: p }); }}
                onMouseUp={(e) => savePause(parseFloat((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) => savePause(parseFloat((e.target as HTMLInputElement).value))}
                className="w-full"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Te presety są używane automatycznie przy generowaniu podcastu (Monolog i Dialog).
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
