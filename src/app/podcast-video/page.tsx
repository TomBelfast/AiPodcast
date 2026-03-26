'use client';

import { useEffect, useMemo, useState } from 'react';

type InputMode = 'script' | 'conversation' | 'transcript';

interface ClientJob {
  jobId: string;
  title: string;
  language: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  stage: string;
  progress: number;
  message: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  engineUsed: 'nca' | 'local' | null;
  renderMode:
    | 'nca_auto'
    | 'nca_exact_classic'
    | 'local_highlight_exact'
    | 'local_classic_exact'
    | null;
  fallbackReason: string | null;
  captionSettings: {
    style: string;
    font_size: number;
    line_color: string;
    word_color: string;
    outline_color: string;
  };
  artifacts: {
    json_url: string | null;
    mp3_url: string | null;
    srt_url: string | null;
    mp4_url: string | null;
  };
  availableArtifacts?: {
    json: boolean;
    mp3: boolean;
    srt: boolean;
    mp4: boolean;
  };
}

const defaultScript = `Napisz krotki podcast o tym, jak AI pomaga porzadkowac prace zespolu i szybciej zamykac zadania.`;

const defaultConversation = JSON.stringify(
  [
    {
      speaker: 'Antoni',
      text: 'Zauważyłem, że dobrze ustawione AI skraca czas pracy przy codziennych zadaniach.',
    },
    {
      speaker: 'Zofia',
      text: 'To prawda, ale tylko wtedy, gdy proces jest dobrze opisany i ktoś pilnuje jakości wyniku.',
    },
  ],
  null,
  2
);

const defaultTranscript = JSON.stringify(
  {
    source: 'elevenlabs',
    version: 1,
    title: 'Przykladowy transcript',
    duration_seconds: 6.2,
    full_text:
      'Zauważyłem, że dobrze ustawione AI skraca czas pracy przy codziennych zadaniach. To prawda, ale tylko wtedy, gdy proces jest dobrze opisany i ktoś pilnuje jakości wyniku.',
    speakers: [
      {
        id: 'Antoni',
        name: 'Antoni',
        voice_id: 'FF7KdobWPaiR0vkcALHF',
        gender: 'male',
        personality: 'Energetic',
      },
      {
        id: 'Zofia',
        name: 'Zofia',
        voice_id: 'BpjGufoPiobT79j2vtj4',
        gender: 'female',
        personality: 'Pessimistic',
      },
    ],
    segments: [
      {
        id: 0,
        speaker: 'Antoni',
        voice_id: 'FF7KdobWPaiR0vkcALHF',
        dialogue_input_index: 0,
        start_time: 0,
        end_time: 2.9,
        text: 'Zauważyłem, że dobrze ustawione AI skraca czas pracy przy codziennych zadaniach.',
      },
      {
        id: 1,
        speaker: 'Zofia',
        voice_id: 'BpjGufoPiobT79j2vtj4',
        dialogue_input_index: 1,
        start_time: 2.9,
        end_time: 6.2,
        text: 'To prawda, ale tylko wtedy, gdy proces jest dobrze opisany i ktoś pilnuje jakości wyniku.',
      },
    ],
    words: [],
    srt:
      '1\\n00:00:00,000 --> 00:00:02,900\\nAntoni: Zauważyłem, że dobrze ustawione AI skraca czas pracy przy codziennych zadaniach.\\n\\n2\\n00:00:02,900 --> 00:00:06,200\\nZofia: To prawda, ale tylko wtedy, gdy proces jest dobrze opisany i ktoś pilnuje jakości wyniku.\\n',
    warnings: [],
  },
  null,
  2
);

export default function PodcastVideoPage() {
  const [inputMode, setInputMode] = useState<InputMode>('script');
  const [title, setTitle] = useState('Podcast Video Test');
  const [language, setLanguage] = useState('pl');
  const [payloadText, setPayloadText] = useState(defaultScript);
  const [style, setStyle] = useState('highlight');
  const [exactCaptions, setExactCaptions] = useState(true);
  const [fontSize, setFontSize] = useState('86');
  const [lineColor, setLineColor] = useState('#FFFFFF');
  const [wordColor, setWordColor] = useState('#00FF04');
  const [outlineColor, setOutlineColor] = useState('#000000');
  const [activeJob, setActiveJob] = useState<ClientJob | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverVersion, setCoverVersion] = useState(() => Date.now());
  const [selectedCoverFile, setSelectedCoverFile] = useState<File | null>(null);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [coverMessage, setCoverMessage] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);

  const placeholder = useMemo(() => {
    if (inputMode === 'conversation') return defaultConversation;
    if (inputMode === 'transcript') return defaultTranscript;
    return defaultScript;
  }, [inputMode]);

  const coverUrl = useMemo(
    () => `/api/podcast-video/cover?v=${coverVersion}`,
    [coverVersion]
  );

  useEffect(() => {
    if (inputMode === 'script') {
      setPayloadText(defaultScript);
    } else if (inputMode === 'conversation') {
      setPayloadText(defaultConversation);
    } else {
      setPayloadText(defaultTranscript);
    }
  }, [inputMode]);

  useEffect(() => {
    if (!activeJob || activeJob.status === 'success' || activeJob.status === 'failed') {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/podcast-video/jobs/${activeJob.jobId}`, {
          cache: 'no-store',
        });
        const data = await response.json();
        if (response.ok && data.job) {
          setActiveJob(data.job as ClientJob);
        } else if (data.error) {
          setError(data.error);
        }
      } catch (pollError) {
        setError(
          pollError instanceof Error ? pollError.message : 'Failed to refresh podcast video job.'
        );
      }
    }, 3000);

    return () => window.clearInterval(interval);
  }, [activeJob]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        title,
        language,
        exact_captions: exactCaptions,
        style,
        font_size: Number(fontSize),
        line_color: lineColor,
        word_color: wordColor,
        outline_color: outlineColor,
      };

      if (inputMode === 'script') {
        payload.script_text = payloadText;
      } else if (inputMode === 'conversation') {
        payload.conversation = JSON.parse(payloadText);
      } else {
        payload.transcript = JSON.parse(payloadText);
      }

      const response = await fetch('/api/podcast-video/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create podcast video job.');
      }

      setActiveJob(data.job as ClientJob);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to submit job.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCoverUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCoverMessage(null);

    if (!selectedCoverFile) {
      setError('Wybierz plik PNG do podmiany covera.');
      return;
    }

    try {
      setIsUploadingCover(true);
      const formData = new FormData();
      formData.append('file', selectedCoverFile);

      const response = await fetch('/api/podcast-video/cover', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.NEXT_PUBLIC_APP_API_KEY || '',
        },
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update podcast cover.');
      }

      setCoverVersion(Date.now());
      setSelectedCoverFile(null);
      setCoverMessage('Cover PNG został zaktualizowany.');
    } catch (uploadError) {
      setCoverError(uploadError instanceof Error ? uploadError.message : 'Failed to update cover.');
    } finally {
      setIsUploadingCover(false);
    }
  }

  return (
    <div className="monolith-container">
      {/* Header Section */}
      <div className="slab" style={{ padding: '32px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="monolith-title">Pipeline: Video Generator</div>
          <h1 style={{ fontSize: '32px', fontWeight: 800, margin: 0, color: 'white' }}>
            Tekst do gotowego MP4
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', maxWidth: '800px', lineHeight: 1.6 }}>
            Automatyczny proces: generacja rozmowy, synteza audio, normalizacja transcriptu i renderowanie filmu 
            z napisami w wybranym stylu. Wszystko w jednym kroku.
          </p>
        </div>
      </div>

      <div className="monolith-grid">
        {/* Left Column: Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <section className="slab">
            <div className="section-header">
              <h2 className="monolith-title">Konfiguracja Materiału</h2>
            </div>
            
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label className="monolith-title" style={{ fontSize: '11px' }}>Tytuł Projektu</label>
                  <input
                    className="excavated-input"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Wpisz nazwę podcastu..."
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label className="monolith-title" style={{ fontSize: '11px' }}>Język</label>
                  <select
                    className="monolith-select"
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                  >
                    <option value="pl">Polski 🇵🇱</option>
                    <option value="en">English 🇺🇸</option>
                    <option value="de">Deutsch 🇩🇪</option>
                    <option value="fr">Francais 🇫🇷</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="monolith-title" style={{ fontSize: '11px' }}>Tryb Wejściowy</label>
                  <div className="tab-group" style={{ padding: '4px' }}>
                    <button 
                      type="button"
                      className={`tab-btn ${inputMode === 'script' ? 'active' : ''}`}
                      onClick={() => setInputMode('script')}
                      style={{ padding: '4px 12px', fontSize: '11px' }}
                    >
                      TEKST
                    </button>
                    <button 
                      type="button"
                      className={`tab-btn ${inputMode === 'conversation' ? 'active' : ''}`}
                      onClick={() => setInputMode('conversation')}
                      style={{ padding: '4px 12px', fontSize: '11px' }}
                    >
                      CONVO
                    </button>
                    <button 
                      type="button"
                      className={`tab-btn ${inputMode === 'transcript' ? 'active' : ''}`}
                      onClick={() => setInputMode('transcript')}
                      style={{ padding: '4px 12px', fontSize: '11px' }}
                    >
                      TRANSCRIPT
                    </button>
                  </div>
                </div>
                <textarea
                  className="monolith-textarea"
                  value={payloadText}
                  onChange={(event) => setPayloadText(event.target.value)}
                  placeholder={placeholder}
                  style={{ minHeight: '300px', fontSize: '13px', lineHeight: 1.6 }}
                />
              </div>

              <div className="section-header" style={{ marginTop: '12px' }}>
                <h2 className="monolith-title">Wygląd Napisów</h2>
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  fontSize: '13px',
                  color: 'var(--text-muted)',
                }}
              >
                <input
                  type="checkbox"
                  checked={exactCaptions}
                  onChange={(event) => setExactCaptions(event.target.checked)}
                />
                <span>
                  Użyj oryginalnego transcriptu ElevenLabs 1:1. Dla `highlight` system przełączy się
                  na lokalny renderer słowo po słowie; gdy transcript nie ma `words[]`, spadnie do
                  exact `classic`.
                </span>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label className="monolith-title" style={{ fontSize: '10px' }}>Styl</label>
                  <select
                    className="monolith-select"
                    value={style}
                    onChange={(event) => setStyle(event.target.value)}
                  >
                    <option value="highlight">Highlight</option>
                    <option value="classic">Classic</option>
                    <option value="karaoke">Karaoke</option>
                    <option value="word_by_word">Word by Word</option>
                    <option value="underline">Underline</option>
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label className="monolith-title" style={{ fontSize: '10px' }}>Rozmiar</label>
                  <input
                    className="excavated-input"
                    value={fontSize}
                    onChange={(event) => setFontSize(event.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label className="monolith-title" style={{ fontSize: '10px' }}>Tekst</label>
                  <input
                    type="color"
                    className="excavated-input"
                    value={lineColor}
                    onChange={(event) => setLineColor(event.target.value.toUpperCase())}
                    style={{ padding: '4px', cursor: 'pointer', height: '46px' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label className="monolith-title" style={{ fontSize: '10px' }}>Akcent</label>
                  <input
                    type="color"
                    className="excavated-input"
                    value={wordColor}
                    onChange={(event) => setWordColor(event.target.value.toUpperCase())}
                    style={{ padding: '4px', cursor: 'pointer', height: '46px' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label className="monolith-title" style={{ fontSize: '10px' }}>Obrys</label>
                  <input
                    type="color"
                    className="excavated-input"
                    value={outlineColor}
                    onChange={(event) => setOutlineColor(event.target.value.toUpperCase())}
                    style={{ padding: '4px', cursor: 'pointer', height: '46px' }}
                  />
                </div>
              </div>

              {!exactCaptions && (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '12px',
                    background: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.22)',
                    fontSize: '12px',
                    color: '#F6C970',
                  }}
                >
                  Auto-transkrypcja NCA moze roznic sie od oryginalnego tekstu. Wlacz tryb 1:1,
                  jesli zalezy Ci na idealnej zgodnosci napisow.
                </div>
              )}

              {error && (
                <div style={{ 
                  background: 'rgba(239, 68, 68, 0.1)', 
                  border: '1px solid rgba(239, 68, 68, 0.3)', 
                  color: '#ef4444', 
                  padding: '12px', 
                  borderRadius: '12px',
                  fontSize: '13px'
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className={`monolith-btn primary ${isSubmitting ? 'generating-audio' : ''}`}
                style={{ height: '56px', fontSize: '15px', marginTop: '12px' }}
              >
                {isSubmitting ? 'INICJALIZACJA PROCESU...' : 'URUCHOM PIPELINE PODCAST-VIDEO'}
              </button>
            </form>
          </section>
        </div>

        {/* Right Column: Status & Preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <section className="slab">
            <div className="section-header">
              <h2 className="monolith-title">Cover Podcastu</h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                className="slab"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  borderRadius: '16px',
                  background: 'rgba(0,0,0,0.45)',
                }}
              >
                <div style={{ maxWidth: '240px', margin: '0 auto', width: '100%' }}>
                  <img
                    src={coverUrl}
                    alt="Aktualny cover podcast video"
                    style={{
                      width: '100%',
                      display: 'block',
                      aspectRatio: '9 / 16',
                      objectFit: 'contain',
                      background: '#05070d',
                      borderRadius: '12px',
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  padding: '12px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '6px' }}>
                  Aktywny plik
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    wordBreak: 'break-all',
                  }}
                >
                  /root/AiPodcast/podcast_cover.png
                </div>
              </div>

              <form onSubmit={handleCoverUpload} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span className="monolith-title" style={{ fontSize: '10px' }}>Podmien PNG</span>
                  <input
                    type="file"
                    accept="image/png"
                    onChange={(event) => {
                      setCoverMessage(null);
                      setSelectedCoverFile(event.target.files?.[0] || null);
                    }}
                    style={{ fontSize: '12px', color: 'var(--text-muted)' }}
                  />
                </label>

                {selectedCoverFile && (
                  <div
                    style={{
                      padding: '10px 12px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.05)',
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    Wybrany plik: {selectedCoverFile.name}
                  </div>
                )}

                {coverError && (
                  <div
                    style={{
                      padding: '12px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '12px',
                      fontSize: '12px',
                      color: '#ef4444',
                    }}
                  >
                    {coverError}
                  </div>
                )}

                {coverMessage && (
                  <div
                    style={{
                      padding: '12px',
                      background: 'rgba(0,255,4,0.08)',
                      borderRadius: '12px',
                      border: '1px solid rgba(0,255,4,0.22)',
                      fontSize: '12px',
                      color: '#9DFFA0',
                    }}
                  >
                    {coverMessage}
                  </div>
                )}

                <button
                  type="submit"
                  className="monolith-btn"
                  disabled={isUploadingCover}
                  style={{ opacity: isUploadingCover ? 0.7 : 1 }}
                >
                  {isUploadingCover ? 'AKTUALIZUJE PNG...' : 'PODMIEN COVER'}
                </button>
              </form>
            </div>
          </section>

          {/* Status Section */}
          <section className="slab">
            <div className="section-header">
              <h2 className="monolith-title">Status Renderowania</h2>
            </div>
            
            {!activeJob ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#666', fontSize: '13px' }}>
                Brak aktywnego zadania. Skonfiguruj wejście i kliknij przycisk powyżej.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>Aktywny Etap</div>
                  <div style={{ fontSize: '14px', color: 'var(--accent-celadon)', fontWeight: 600 }}>
                    {activeJob.stage}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div
                    style={{
                      padding: '12px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>
                      Silnik Renderu
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>
                      {activeJob.engineUsed || 'pending'}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '12px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="monolith-title" style={{ fontSize: '10px', marginBottom: '4px' }}>
                      Tryb
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>
                      {activeJob.renderMode || 'pending'}
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div className="monolith-title" style={{ fontSize: '10px' }}>Postęp</div>
                    <div style={{ fontSize: '12px', fontWeight: 700 }}>{activeJob.progress}%</div>
                  </div>
                  <div style={{ 
                    height: '8px', 
                    background: 'rgba(0,0,0,0.5)', 
                    borderRadius: '4px', 
                    overflow: 'hidden',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)'
                  }}>
                    <div style={{ 
                      width: `${activeJob.progress}%`, 
                      height: '100%', 
                      background: 'var(--accent-celadon)',
                      boxShadow: '0 0 10px var(--accent-celadon-glow)',
                      transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
                    }} />
                  </div>
                </div>

                <div style={{ 
                  padding: '12px', 
                  background: 'rgba(255,255,255,0.03)', 
                  borderRadius: '12px', 
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  border: '1px solid rgba(255,255,255,0.05)'
                }}>
                  {activeJob.message}
                </div>

                {activeJob.fallbackReason && (
                  <div
                    style={{
                      padding: '12px',
                      background: 'rgba(245, 158, 11, 0.08)',
                      borderRadius: '12px',
                      border: '1px solid rgba(245, 158, 11, 0.22)',
                      fontSize: '12px',
                      color: '#F6C970',
                    }}
                  >
                    Fallback lokalny: {activeJob.fallbackReason}
                  </div>
                )}

                {activeJob.error && (
                  <div className="slab danger" style={{ padding: '12px', fontSize: '12px' }}>
                    {activeJob.error}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Artifacts Section */}
          <section className="slab">
            <div className="section-header">
              <h2 className="monolith-title">Artefakty Pipeline</h2>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ opacity: activeJob ? 1 : 0.4 }}>
                <a 
                  href={activeJob?.artifacts.json_url || '#'} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="monolith-btn"
                  style={{ display: 'flex', justifyContent: 'space-between', textDecoration: 'none' }}
                >
                  <span>JSON TRANSCRIPT</span>
                  <span style={{ fontSize: '10px', opacity: 0.6 }}>{activeJob?.availableArtifacts?.json ? 'READY' : 'WAITING'}</span>
                </a>
              </div>
              <div style={{ opacity: activeJob ? 1 : 0.4 }}>
                <a 
                  href={activeJob?.artifacts.mp3_url || '#'} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="monolith-btn"
                  style={{ display: 'flex', justifyContent: 'space-between', textDecoration: 'none' }}
                >
                  <span>AUDIO MP3</span>
                  <span style={{ fontSize: '10px', opacity: 0.6 }}>{activeJob?.availableArtifacts?.mp3 ? 'READY' : 'WAITING'}</span>
                </a>
              </div>
              <div style={{ opacity: activeJob ? 1 : 0.4 }}>
                <a 
                  href={activeJob?.artifacts.srt_url || '#'} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="monolith-btn"
                  style={{ display: 'flex', justifyContent: 'space-between', textDecoration: 'none' }}
                >
                  <span>CAPTIONS SRT</span>
                  <span style={{ fontSize: '10px', opacity: 0.6 }}>{activeJob?.availableArtifacts?.srt ? 'READY' : 'WAITING'}</span>
                </a>
              </div>
              <div style={{ opacity: activeJob?.status === 'success' ? 1 : 0.4 }}>
                <a 
                  href={activeJob?.artifacts.mp4_url || '#'} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="monolith-btn primary"
                  style={{ display: 'flex', justifyContent: 'space-between', textDecoration: 'none' }}
                >
                  <span>FINAL MP4</span>
                  <span style={{ fontSize: '10px', fontWeight: 800 }}>{activeJob?.availableArtifacts?.mp4 ? 'DOWNLOAD' : 'WAITING'}</span>
                </a>
              </div>
            </div>
          </section>

          {/* Video Preview Section */}
          {(activeJob?.status === 'success' && activeJob.artifacts.mp4_url) && (
            <section className="slab audio-ready">
              <div className="section-header">
                <h2 className="monolith-title">Podgląd Wyniku</h2>
              </div>
              <video
                src={activeJob.artifacts.mp4_url}
                controls
                className="slab"
                style={{ width: '100%', padding: 0, overflow: 'hidden', background: 'black', borderRadius: '16px' }}
              />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
