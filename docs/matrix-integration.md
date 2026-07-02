# Integracja z Matrix (SocialMedia Backend)

## Przegląd architektury

AiPodcast (`192.168.0.54`, port `3300`) jest usługą backendową wywoływaną przez SocialMedia Backend (`192.168.0.35`, alias SSH: `matrix`). Użytkownicy widzą kartę statusu generowania bezpośrednio w interfejsie Matrix.

```
┌─────────────────────────────────────────────────────────────────┐
│  Użytkownik Matrix (przeglądarka)                               │
│  → widzi kartę statusu: "Generuję audio 2/9 · 40%"             │
└──────────────────────────┬──────────────────────────────────────┘
                           │ polling (co ~3s)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  SocialMedia Backend (192.168.0.35)                             │
│  GET /api/tasks/podcast-video/podcast-film/active-job           │
│  → odpytuje DB (PodcastVisualJob) i zwraca bieżący procent/fazę │
└──────────────────────────┬──────────────────────────────────────┘
                           │ proxy + callback push (od v2026-05-29)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  AiPodcast API (192.168.0.54:3300)                              │
│  POST /api/podcast-video/podcast-film/jobs  → tworzy job        │
│  GET  /api/podcast-video/podcast-film/jobs/{jobId}/status       │
│       → czyta status.json z dysku                               │
└──────────────────────────┬──────────────────────────────────────┘
                           │ zapisuje na dysk co etap
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Orchestrator (src/lib/podcast-video/orchestrator.ts)           │
│  + job-status.ts → setPhase() → atomic write status.json        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Etapy generowania i statusy

### AiPodcast — fazy orchestratora

Każda faza jest zapisywana atomowo do `archive/podcast-video-podcast-film/{jobId}/status.json`:

| `phase`                  | `percent` | Opis                                  |
|--------------------------|-----------|---------------------------------------|
| `preparing-input`        | 10        | Sprawdzenie wejścia i covera          |
| `generating-conversation`| 22        | Generowanie skryptu z LLM             |
| `generating-audio`       | 40        | Synteza audio (Gemini / ElevenLabs)   |
| `generating-audio-stems` | 45        | Podział na ścieżki głosowe (stems)    |
| `building-transcript`    | 52        | Budowanie JSON + SRT                  |
| `uploading-assets`       | 60        | Upload do MinIO                       |
| `composing-video`        | 72        | Składanie MP4 (NCA lub lokalnie)      |
| `rendering-captions`     | 88        | Wypalanie napisów                     |
| `success`                | 100       | Gotowe                                |
| `failed`                 | —         | Błąd — szczegóły w polu `error`       |

### Endpoint statusu

```
GET /api/podcast-video/podcast-film/jobs/{jobId}/status
Authorization: x-api-key: <APP_API_KEY>
```

**Przykładowa odpowiedź (w trakcie):**
```json
{
  "job_id": "podcast_video_1234567890_abc123",
  "state": "running",
  "phase": "generating-audio",
  "phase_index": 2,
  "phase_total": 7,
  "percent": 40,
  "message": "Tworze audio z Gemini direct 2/9.",
  "started_at": "2026-05-29T14:00:00Z",
  "updated_at": "2026-05-29T14:01:30Z",
  "result": null,
  "error": null
}
```

**Przykładowa odpowiedź (sukces):**
```json
{
  "job_id": "podcast_video_1234567890_abc123",
  "state": "done",
  "percent": 100,
  "message": "Done",
  "success": true,
  "mp4_url": "https://pcminio-api.aihub.ovh/podcast/podcast_video_1234567890_abc123.mp4",
  "srt_url": "https://pcminio-api.aihub.ovh/podcast/podcast_video_1234567890_abc123.srt"
}
```

---

## Mechanizm powiadomień (callback push)

### Przed v2026-05-29 (tylko polling)

SocialMedia Backend odpytywał endpoint `/status` co kilka sekund. Karta statusu w Matrix aktualizowała się z opóźnieniem równym interwałowi pollingu.

### Od v2026-05-29 (callback push + polling jako fallback)

Na serwerze Matrix (`/opt/SocialMedia/podcast-studio/scripts/studio_jobs.py`) zmieniono funkcję `update_job` tak, żeby wysyłała callback przy **każdej zmianie statusu**, nie tylko na końcu:

```python
def update_job(job_id: str, **changes: Any) -> dict[str, Any]:
    job = load_job(job_id)
    job.update(changes)
    save_job(job)
    # Push callback on every status change — not just at the end.
    # This lets the Matrix status card react instantly instead of waiting for polling.
    if "status" in changes:
        _notify_callback(job)
    return job
```

**Payload callback (POST na `callback_url`):**
```json
{
  "job_id": "abc123...",
  "status": "running_tts",
  "result_url": "/api/v1/jobs/abc123.../result",
  "status_url": "/api/v1/jobs/abc123...",
  "error": null
}
```

Sekwencja statusów wysyłanych przez callback:
```
queued → running_script → running_tts → done
                                      ↘ failed
```

Polling po stronie Matrixa pozostaje jako **fallback** na wypadek niedostarczenia callbacku.

---

## Jak wywołać generowanie przez webhook z Matrix

Wywołanie z SocialMedia Backend do AiPodcast (`/api/podcast-video/podcast-film/jobs`):

```bash
curl -X POST http://192.168.0.54:3300/api/podcast-video/podcast-film/jobs \
  -H "Content-Type: application/json" \
  -H "x-api-key: <APP_API_KEY>" \
  -d '{
    "title": "Tytuł podcastu",
    "raw_text": "Treść artykułu...",
    "language": "pl",
    "tts": { "provider": "gemini" },
    "review": { "mode": "off" }
  }'
```

**Odpowiedź (202 Accepted):**
```json
{
  "job_id": "podcast_video_1234567890_abc123",
  "status": "queued",
  "status_url": "/api/podcast-video/podcast-film/jobs/podcast_video_.../status"
}
```

Od tego momentu status jest dostępny pod `status_url` i aktualizowany w czasie rzeczywistym.

---

## Powiązane pliki

### AiPodcast (`192.168.0.54`)
| Plik | Rola |
|------|------|
| `src/lib/podcast-video/orchestrator.ts` | Główna logika pipeline — wywołuje `setPhase()` co etap |
| `src/lib/podcast-video/job-status.ts` | Zapis/odczyt `status.json`, atomowy write, stale-job recovery |
| `src/lib/podcast-video/jobs.ts` | Rejestr jobów w pamięci i na dysku |
| `src/app/api/podcast-video/podcast-film/jobs/route.ts` | Endpoint tworzenia i listowania jobów |
| `src/app/api/podcast-video/podcast-film/jobs/[jobId]/status/route.ts` | Endpoint odpytywania statusu |

### SocialMedia Backend (`192.168.0.35`)
| Plik | Rola |
|------|------|
| `/opt/SocialMedia/podcast-studio/podcast_api.py` | FastAPI serwer — przyjmuje webhooki, kolejkuje joby |
| `/opt/SocialMedia/podcast-studio/scripts/studio_jobs.py` | Kolejka jobów, logika `update_job` z callback push |
| `/opt/SocialMedia/backend/app/api/routers/tasks_podcast_video_proxy.py` | Proxy do AiPodcast, endpoint `active-job` dla karty statusu Matrix |

---

## Zmienne środowiskowe (AiPodcast)

| Zmienna | Opis |
|---------|------|
| `NEXT_PUBLIC_APP_URL` | Publiczny URL aplikacji AiPodcast |
| `INTERNAL_APP_URL` | Wewnętrzny URL (domyślnie `http://127.0.0.1:3300`) |
| `APP_API_KEY` | Klucz autoryzacyjny dla endpointów podcast-video i v1 |
| `PODCAST_VIDEO_NCA_API_URL` | URL serwisu NCA do renderowania wideo |
| `PODCAST_VIDEO_NCA_SECRET_KEY` | Klucz NCA |
| `PODCAST_VIDEO_NCA_PUBLIC_STORAGE_URL` | Publiczny URL MinIO do serwowania plików |
| `MINIO_ENDPOINT` | Endpoint MinIO do uploadu |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | Dane dostępu MinIO |
| `GEMINI_API_KEY` | Klucz Gemini TTS |
| `ELEVENLABS_API_KEY` | Klucz ElevenLabs TTS |
