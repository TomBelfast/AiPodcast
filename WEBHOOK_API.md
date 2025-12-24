# Webhook API Documentation

Aplikacja obsługuje webhooki do automatycznego przetwarzania transkryptów i generowania podcastów.

## Przepływ pracy

1. **Odbierz transkrypt** → `/api/webhook/transcript`
2. **Przetwórz i wygeneruj konwersację** → `/api/webhook/process`
3. **Zatwierdź i wygeneruj audio** → `/api/webhook/approve`
4. **Pobierz plik MP3** → `/api/webhook/download/[jobId]`

---

## Endpointy

### 1. POST `/api/webhook/transcript`

Odbiera transkrypt przez webhook.

**Request Body:**
```json
{
  "transcript": "Pełny tekst transkryptu...",
  "title": "Tytuł podcastu (opcjonalne)",
  "language": "pl",
  "metadata": {
    "source": "źródło"
  }
}
```

**Parametry:**
- `transcript` (wymagane) - Pełny tekst transkryptu do przetworzenia
- `title` (opcjonalne) - Tytuł podcastu
- `language` (opcjonalne) - Kod języka dla generowania konwersacji. Dostępne: `en`, `pl`, `es`, `fr`, `de`, `it`, `pt`, `ru`, `ja`, `ko`, `zh`. Domyślnie: `en`
- `metadata` (opcjonalne) - Dodatkowe metadane

**Response:**
```json
{
  "success": true,
  "jobId": "job_1234567890_abc123",
  "message": "Transcript received successfully",
  "nextStep": {
    "url": "http://localhost:3000/api/webhook/process",
    "method": "POST",
    "body": {
      "jobId": "job_1234567890_abc123",
      "transcript": "...",
      "title": "...",
      "metadata": {}
    }
  }
}
```

---

### 2. POST `/api/webhook/process`

Przetwarza transkrypt i generuje konwersację podcastową.

**Request Body:**
```json
{
  "jobId": "job_1234567890_abc123",
  "transcript": "Pełny tekst transkryptu...",
  "title": "Tytuł podcastu",
  "language": "pl",
  "metadata": {}
}
```

**Parametry:**
- `jobId` (wymagane) - ID zadania z poprzedniego kroku
- `transcript` (wymagane) - Pełny tekst transkryptu
- `title` (opcjonalne) - Tytuł podcastu
- `language` (opcjonalne) - Kod języka (`en`, `pl`, `es`, `fr`, `de`, `it`, `pt`, `ru`, `ja`, `ko`, `zh`). Domyślnie: `en`
- `metadata` (opcjonalne) - Dodatkowe metadane

**Response:**
```json
{
  "success": true,
  "jobId": "job_1234567890_abc123",
  "conversation": [
    {
      "speaker": "Speaker1",
      "text": "Tekst wypowiedzi..."
    },
    {
      "speaker": "Speaker2",
      "text": "Odpowiedź..."
    }
  ],
  "title": "Tytuł podcastu",
  "approvalUrl": "http://localhost:3000/api/webhook/approve",
  "message": "Conversation generated. Please review and approve."
}
```

---

### 3. POST `/api/webhook/approve`

Zatwierdza konwersację i generuje plik audio MP3.

**Request Body:**
```json
{
  "jobId": "job_1234567890_abc123",
  "conversation": [
    {
      "speaker": "Speaker1",
      "text": "Tekst wypowiedzi..."
    }
  ],
  "title": "Tytuł podcastu",
  "voice1": "FF7KdobWPaiR0vkcALHF",
  "voice2": "BpjGufoPiobT79j2vtj4",
  "uploadToMinIO": true
}
```

**Response:**
```json
{
  "success": true,
  "jobId": "job_1234567890_abc123",
  "downloadUrl": "http://localhost:3000/api/webhook/download/job_1234567890_abc123",
  "minioUrl": "https://minio.example.com/podcasts/podcast_job_1234567890_abc123.mp3?X-Amz-Algorithm=...",
  "filename": "podcast_job_1234567890_abc123.mp3",
  "message": "Audio generated successfully"
}
```

**Parametry:**
- `jobId` (wymagane) - ID zadania z poprzedniego kroku
- `conversation` (wymagane) - Tablica konwersacji do zatwierdzenia
- `title` (opcjonalne) - Tytuł podcastu
- `voice1` (opcjonalne) - ID głosu dla Speaker1 (domyślnie: FF7KdobWPaiR0vkcALHF)
- `voice2` (opcjonalne) - ID głosu dla Speaker2 (domyślnie: BpjGufoPiobT79j2vtj4)
- `uploadToMinIO` (opcjonalne) - Czy przesłać do MinIO (domyślnie: false)

---

### 4. GET `/api/webhook/download/[jobId]`

Pobiera wygenerowany plik MP3.

**Response:**
- Content-Type: `audio/mpeg`
- Plik MP3 do pobrania

---

## Integracja z MinIO

Aby włączyć automatyczne przesyłanie plików do MinIO, skonfiguruj następujące zmienne środowiskowe:

**Opcja 1: Osobne parametry (dla zewnętrznego MinIO)**
```env
MINIO_ENDPOINT=minio2-api.aihub.ovh
MINIO_PORT=9001
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
MINIO_BUCKET_NAME=podcast
```

**Opcja 2: Pełny URL (automatycznie parsowany)**
```env
MINIO_ENDPOINT=https://minio2-api.aihub.ovh:9001
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
MINIO_BUCKET_NAME=podcast
```

**Uwaga:** 
- Jeśli `uploadToMinIO` jest `true`, plik zostanie przesłany do MinIO i zwrócony będzie presigned URL (ważny 7 dni)
- W przeciwnym razie plik będzie dostępny przez endpoint `/api/webhook/download/[jobId]`
- Kod automatycznie wykrywa protokół HTTPS z pełnego URL i ustawia odpowiednie parametry

---

## Przykład użycia (cURL)

### 1. Wyślij transkrypt
```bash
curl -X POST http://localhost:3000/api/webhook/transcript \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "To jest przykładowy transkrypt...",
    "title": "Mój Podcast",
    "language": "pl"
  }'
```

### 2. Przetwórz transkrypt
```bash
curl -X POST http://localhost:3000/api/webhook/process \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "job_1234567890_abc123",
    "transcript": "To jest przykładowy transkrypt...",
    "title": "Mój Podcast",
    "language": "pl"
  }'
```

### 3. Zatwierdź i wygeneruj audio
```bash
curl -X POST http://localhost:3000/api/webhook/approve \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "job_1234567890_abc123",
    "conversation": [
      {"speaker": "Speaker1", "text": "Cześć!"},
      {"speaker": "Speaker2", "text": "Witaj!"}
    ],
    "title": "Mój Podcast",
    "uploadToMinIO": true
  }'
```

### 4. Pobierz plik
```bash
curl -O http://localhost:3000/api/webhook/download/job_1234567890_abc123
```

---

## Statusy odpowiedzi

- `200` - Sukces
- `400` - Błędne żądanie (brak wymaganych parametrów)
- `404` - Nie znaleziono (plik/jobId)
- `500` - Błąd serwera

---

## Uwagi

1. **Job ID** jest unikalnym identyfikatorem generowanym automatycznie przy pierwszym webhooku
2. **Konwersacja** może być edytowana przed zatwierdzeniem
3. **MinIO** jest opcjonalne - jeśli nie jest skonfigurowane, pliki są przechowywane lokalnie
4. **Presigned URLs** z MinIO są ważne przez 7 dni

