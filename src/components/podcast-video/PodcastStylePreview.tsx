'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type GeneratorCaptionDefaults = {
  style: string;
  fontSize: string;
  lineColor: string;
  wordColor: string;
  outlineColor: string;
};

export type GeneratorCoverDefaults = {
  titleSize: number;
  titleMarginX: number;
  titleOffsetY: number;
  titleColor: string;
  titleOutlineColor: string;
  topText: string;
  scriptText: string;
  arcSize: number;
  arcOffsetY: number;
  arcMargin: number;
  arcWidth: number;
  arcBend: number;
};

type CaptionPreviewMode = 'highlight' | 'classic' | 'karaoke';
type CaptionFont = 'dejavu' | 'open-sans' | 'noto' | 'montserrat' | 'poppins';
type CoverLayout = 'arc' | 'stack' | 'lower';
type PreviewMode = 'title' | 'captions';

type PodcastStylePreviewSettings = {
  captionStyle: CaptionPreviewMode;
  captionFont: CaptionFont;
  captionSize: number;
  captionColor: string;
  captionActiveColor: string;
  captionOutlineColor: string;
  waveColor: string;
  topText: string;
  scriptText: string;
  mainTitle: string;
  coverLayout: CoverLayout;
  previewMode: PreviewMode;
  titleSize: number;
  titleMarginX: number;
  titleOffsetY: number;
  arcSize: number;
  arcOffsetY: number;
  arcMargin: number;
  arcWidth: number;
  arcBend: number;
  scriptSize: number;
  titleColor: string;
  titleOutlineColor: string;
  scriptColor: string;
};

type PodcastStylePreviewProps = {
  coverUrl: string;
  onApplyCaptionDefaults?: (settings: GeneratorCaptionDefaults) => void;
};

const STORAGE_KEY = 'ai-podcast-video-style-defaults';

const ESTABLISHED_STYLE_PRESET: PodcastStylePreviewSettings = {
  captionStyle: 'highlight',
  captionFont: 'dejavu',
  captionSize: 38,
  captionColor: '#F7F9FC',
  captionActiveColor: '#E6FF55',
  captionOutlineColor: '#000000',
  waveColor: '#E6FF55',
  topText: 'AI W BIZNESIE PL',
  scriptText: 'Ai podcast',
  mainTitle: 'SZTUCZNA\nINTELIGENCJA\nW\nMARKETINGU',
  coverLayout: 'arc',
  previewMode: 'title',
  titleSize: 43,
  titleMarginX: 18,
  titleOffsetY: 0,
  arcSize: 42,
  arcOffsetY: 0,
  arcMargin: 0,
  arcWidth: 450,
  arcBend: 132,
  scriptSize: 26,
  titleColor: '#25FF00',
  titleOutlineColor: '#050608',
  scriptColor: '#F7F9FC',
};

const captionFonts: Record<CaptionFont, { label: string; stack: string }> = {
  dejavu: {
    label: 'DejaVu Sans Bold',
    stack: '"Podcast Title DejaVu", "DejaVu Sans", "Arial Black", Arial, sans-serif',
  },
  'open-sans': {
    label: 'Open Sans ExtraBold',
    stack: '"Open Sans", "Arial Black", "DejaVu Sans", Arial, sans-serif',
  },
  noto: {
    label: 'Noto Sans Black',
    stack: '"Noto Sans", "Arial Black", "DejaVu Sans", Arial, sans-serif',
  },
  montserrat: {
    label: 'Montserrat ExtraBold',
    stack: 'Montserrat, "Arial Black", "DejaVu Sans", Arial, sans-serif',
  },
  poppins: {
    label: 'Poppins Bold',
    stack: 'Poppins, "Arial Black", "DejaVu Sans", Arial, sans-serif',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function readOption<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeHex(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toUpperCase() : fallback;
}

function sanitizeSettings(value: unknown): PodcastStylePreviewSettings {
  if (!isRecord(value)) {
    return ESTABLISHED_STYLE_PRESET;
  }

  return {
    captionStyle: readOption(value.captionStyle, ['highlight', 'classic', 'karaoke'] as const, ESTABLISHED_STYLE_PRESET.captionStyle),
    captionFont: readOption(value.captionFont, ['dejavu', 'open-sans', 'noto', 'montserrat', 'poppins'] as const, ESTABLISHED_STYLE_PRESET.captionFont),
    captionSize: readNumber(value.captionSize, ESTABLISHED_STYLE_PRESET.captionSize, 24, 58),
    captionColor: normalizeHex(value.captionColor, ESTABLISHED_STYLE_PRESET.captionColor),
    captionActiveColor: normalizeHex(value.captionActiveColor, ESTABLISHED_STYLE_PRESET.captionActiveColor),
    captionOutlineColor: normalizeHex(value.captionOutlineColor, ESTABLISHED_STYLE_PRESET.captionOutlineColor),
    waveColor: normalizeHex(value.waveColor, ESTABLISHED_STYLE_PRESET.waveColor),
    topText: readString(value.topText, ESTABLISHED_STYLE_PRESET.topText),
    scriptText: readString(value.scriptText, ESTABLISHED_STYLE_PRESET.scriptText),
    mainTitle: readString(value.mainTitle, ESTABLISHED_STYLE_PRESET.mainTitle),
    coverLayout: readOption(value.coverLayout, ['arc', 'stack', 'lower'] as const, ESTABLISHED_STYLE_PRESET.coverLayout),
    previewMode: readOption(value.previewMode, ['title', 'captions'] as const, ESTABLISHED_STYLE_PRESET.previewMode),
    titleSize: readNumber(value.titleSize, ESTABLISHED_STYLE_PRESET.titleSize, 28, 58),
    titleMarginX: readNumber(value.titleMarginX, ESTABLISHED_STYLE_PRESET.titleMarginX, 0, 46),
    titleOffsetY: readNumber(value.titleOffsetY, ESTABLISHED_STYLE_PRESET.titleOffsetY, -450, 450),
    arcSize: readNumber(value.arcSize, ESTABLISHED_STYLE_PRESET.arcSize, 18, 42),
    arcOffsetY: readNumber(value.arcOffsetY, ESTABLISHED_STYLE_PRESET.arcOffsetY, -28, 40),
    arcMargin: readNumber(value.arcMargin, ESTABLISHED_STYLE_PRESET.arcMargin, 0, 96),
    arcWidth: readNumber(value.arcWidth, ESTABLISHED_STYLE_PRESET.arcWidth, 240, 560),
    arcBend: readNumber(value.arcBend, ESTABLISHED_STYLE_PRESET.arcBend, 8, 132),
    scriptSize: readNumber(value.scriptSize, ESTABLISHED_STYLE_PRESET.scriptSize, 16, 42),
    titleColor: normalizeHex(value.titleColor, ESTABLISHED_STYLE_PRESET.titleColor),
    titleOutlineColor: normalizeHex(value.titleOutlineColor, ESTABLISHED_STYLE_PRESET.titleOutlineColor),
    scriptColor: normalizeHex(value.scriptColor, ESTABLISHED_STYLE_PRESET.scriptColor),
  };
}

function loadSavedSettings(): PodcastStylePreviewSettings {
  if (typeof window === 'undefined') {
    return ESTABLISHED_STYLE_PRESET;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? sanitizeSettings(JSON.parse(stored)) : ESTABLISHED_STYLE_PRESET;
  } catch {
    return ESTABLISHED_STYLE_PRESET;
  }
}

function saveSettings(settings: PodcastStylePreviewSettings): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

function splitTitleWords(value: string): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 ? words : ['TYTUŁ'];
}

function toGeneratorCaptionDefaults(settings: PodcastStylePreviewSettings): GeneratorCaptionDefaults {
  return {
    style: settings.captionStyle,
    fontSize: String(Math.max(24, Math.round(settings.captionSize * 2.26))),
    lineColor: settings.captionColor,
    wordColor: settings.captionActiveColor,
    outlineColor: settings.captionOutlineColor,
  };
}

function toGeneratorCoverDefaults(settings: PodcastStylePreviewSettings): GeneratorCoverDefaults {
  return {
    titleSize: settings.titleSize,
    titleMarginX: settings.titleMarginX,
    titleOffsetY: settings.titleOffsetY,
    titleColor: settings.titleColor,
    titleOutlineColor: settings.titleOutlineColor,
    topText: settings.topText,
    scriptText: settings.scriptText,
    arcSize: settings.arcSize,
    arcOffsetY: settings.arcOffsetY,
    arcMargin: settings.arcMargin,
    arcWidth: settings.arcWidth,
    arcBend: settings.arcBend,
  };
}

export function getSavedGeneratorCoverDefaults(): GeneratorCoverDefaults {
  return toGeneratorCoverDefaults(loadSavedSettings());
}

function rangeValue(value: number, suffix = '') {
  return `${value}${suffix}`;
}

export function PodcastStylePreview({
  coverUrl,
  onApplyCaptionDefaults,
}: PodcastStylePreviewProps) {
  const [settings, setSettings] = useState<PodcastStylePreviewSettings>(ESTABLISHED_STYLE_PRESET);
  const [status, setStatus] = useState<string>('Preset załadowany. Możesz zmienić wartości i zapisać je jako domyślne.');
  const [fittedTitleSize, setFittedTitleSize] = useState(settings.titleSize);
  const [showTopText, setShowTopText] = useState(true);
  const [showScriptText, setShowScriptText] = useState(true);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mainTitleRef = useRef<HTMLDivElement | null>(null);

  const titleWords = useMemo(() => splitTitleWords(settings.mainTitle), [settings.mainTitle]);
  const activeFont = captionFonts[settings.captionFont] || captionFonts.dejavu;
  const arcControlY = Math.max(-42, 92 - settings.arcBend);
  const arcStartX = -56 + settings.arcMargin;
  const arcEndX = 416 - settings.arcMargin;
  const titleMode = settings.previewMode === 'title';

  useEffect(() => {
    const saved = loadSavedSettings();
    setSettings(saved);
    setStatus('Załadowano domyślne ustawienia podglądu dla tej przeglądarki.');
  }, []);

  useLayoutEffect(() => {
    const titleNode = mainTitleRef.current;
    const stageNode = stageRef.current;
    if (!titleNode || !stageNode) {
      return;
    }

    titleNode.style.fontSize = `${settings.titleSize}px`;
    const lines = Array.from(titleNode.querySelectorAll('.podcast-style-title-line'));
    if (lines.length === 0) {
      setFittedTitleSize(settings.titleSize);
      return;
    }

    const stageBox = stageNode.getBoundingClientRect();
    const safeTop = stageBox.top + 24;
    const safeBottom = stageBox.bottom - 24;
    const availableWidth = Math.max(1, titleNode.clientWidth - 2);
    const availableHeight = Math.max(1, safeBottom - safeTop);
    const widestLine = Math.max(...lines.map((line) => line.getBoundingClientRect().width));
    const currentHeight = Math.max(1, titleNode.getBoundingClientRect().height);
    const widthRatio = widestLine > availableWidth ? availableWidth / widestLine : 1;
    const heightRatio = currentHeight > availableHeight ? availableHeight / currentHeight : 1;
    const minSize = 8;
    let nextSize = Math.max(minSize, Math.floor(settings.titleSize * Math.min(1, widthRatio, heightRatio)));

    titleNode.style.fontSize = `${nextSize}px`;

    for (let attempt = 0; attempt < 16; attempt += 1) {
      const currentBox = titleNode.getBoundingClientRect();
      const stillTooWide =
        Math.max(...lines.map((line) => line.getBoundingClientRect().width)) > availableWidth;
      const stillTooTall = currentBox.top < safeTop || currentBox.bottom > safeBottom;
      if ((!stillTooWide && !stillTooTall) || nextSize <= minSize) {
        break;
      }
      nextSize = Math.max(minSize, nextSize - 1);
      titleNode.style.fontSize = `${nextSize}px`;
    }

    setFittedTitleSize((current) => (current === nextSize ? current : nextSize));
  }, [
    settings.coverLayout,
    settings.mainTitle,
    settings.titleMarginX,
    settings.titleOffsetY,
    settings.titleSize,
    settings.previewMode,
  ]);

  function updateSetting<Key extends keyof PodcastStylePreviewSettings>(
    key: Key,
    value: PodcastStylePreviewSettings[Key]
  ) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleSaveDefaults() {
    const saved = saveSettings(settings);
    onApplyCaptionDefaults?.(toGeneratorCaptionDefaults(settings));
    setStatus(
      saved
        ? 'Zapisano jako domyślne dla tej przeglądarki i zastosowano ustawienia napisów w generatorze.'
        : 'Ustawienia napisów zastosowano w generatorze, ale przeglądarka zablokowała zapis domyślnych.'
    );
  }

  function handleResetToPreset() {
    setSettings(ESTABLISHED_STYLE_PRESET);
    const saved = saveSettings(ESTABLISHED_STYLE_PRESET);
    onApplyCaptionDefaults?.(toGeneratorCaptionDefaults(ESTABLISHED_STYLE_PRESET));
    setStatus(
      saved
        ? 'Przywrócono ustalony preset i zapisano go jako domyślny.'
        : 'Przywrócono ustalony preset, ale przeglądarka zablokowała zapis domyślnych.'
    );
  }

  return (
    <section className="podcast-style-shell">
      <div className="podcast-style-topbar">
        <div>
          <div className="podcast-style-kicker">Style preview</div>
          <h2>Podgląd covera i napisów</h2>
        </div>
        <div className="podcast-style-actions">
          <button type="button" className="podcast-style-btn" onClick={handleResetToPreset}>
            Reset do presetu
          </button>
          <button type="button" className="podcast-style-btn primary" onClick={handleSaveDefaults}>
            Zapisz jako domyślne
          </button>
        </div>
      </div>

      <div className="podcast-style-grid">
        <div className="podcast-style-controls">
          <section className="podcast-style-panel">
            <div className="podcast-style-panel-head">
              <h3>Napisy</h3>
              <span>burn style</span>
            </div>
            <div className="podcast-style-field-grid">
              <label>
                Styl
                <select
                  value={settings.captionStyle}
                  onChange={(event) => updateSetting('captionStyle', event.target.value as CaptionPreviewMode)}
                >
                  <option value="highlight">Highlight</option>
                  <option value="classic">Classic</option>
                  <option value="karaoke">Karaoke</option>
                </select>
              </label>
              <label>
                Font
                <select
                  value={settings.captionFont}
                  onChange={(event) => updateSetting('captionFont', event.target.value as CaptionFont)}
                >
                  {Object.entries(captionFonts).map(([value, font]) => (
                    <option key={value} value={value}>
                      {font.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="podcast-style-range-grid">
              <RangeControl
                label="Rozmiar"
                value={settings.captionSize}
                min={24}
                max={58}
                suffix="px"
                onChange={(value) => updateSetting('captionSize', value)}
              />
              <ColorControl label="Tekst" value={settings.captionColor} onChange={(value) => updateSetting('captionColor', value)} />
              <ColorControl label="Akcent" value={settings.captionActiveColor} onChange={(value) => updateSetting('captionActiveColor', value)} />
              <ColorControl label="Obrys" value={settings.captionOutlineColor} onChange={(value) => updateSetting('captionOutlineColor', value)} />
              <ColorControl label="Wave" value={settings.waveColor} onChange={(value) => updateSetting('waveColor', value)} />
            </div>
          </section>

          <section className="podcast-style-panel">
            <div className="podcast-style-panel-head">
              <h3>Tytuły covera</h3>
              <span>first frame</span>
            </div>
            <div className="podcast-style-field-grid">
              <label>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  Górny tytuł
                  <button
                    type="button"
                    onClick={() => setShowTopText((v) => !v)}
                    title={showTopText ? 'Ukryj warstwę' : 'Pokaż warstwę'}
                    style={{
                      padding: '2px 8px',
                      fontSize: '10px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: '1px solid',
                      cursor: 'pointer',
                      background: showTopText ? 'rgba(37,255,0,0.15)' : 'rgba(239,68,68,0.15)',
                      borderColor: showTopText ? '#25FF00' : '#ef4444',
                      color: showTopText ? '#25FF00' : '#ef4444',
                      lineHeight: 1,
                    }}
                  >
                    {showTopText ? '● WIDOCZNA' : '○ UKRYTA'}
                  </button>
                </span>
                <input
                  value={settings.topText}
                  onChange={(event) => updateSetting('topText', event.target.value)}
                />
              </label>
              <label>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  Podpis
                  <button
                    type="button"
                    onClick={() => setShowScriptText((v) => !v)}
                    title={showScriptText ? 'Ukryj warstwę' : 'Pokaż warstwę'}
                    style={{
                      padding: '2px 8px',
                      fontSize: '10px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: '1px solid',
                      cursor: 'pointer',
                      background: showScriptText ? 'rgba(37,255,0,0.15)' : 'rgba(239,68,68,0.15)',
                      borderColor: showScriptText ? '#25FF00' : '#ef4444',
                      color: showScriptText ? '#25FF00' : '#ef4444',
                      lineHeight: 1,
                    }}
                  >
                    {showScriptText ? '● WIDOCZNA' : '○ UKRYTA'}
                  </button>
                </span>
                <input
                  value={settings.scriptText}
                  onChange={(event) => updateSetting('scriptText', event.target.value)}
                />
              </label>
            </div>
            <label className="podcast-style-field">
              Główny tytuł
              <textarea
                value={settings.mainTitle}
                onChange={(event) => updateSetting('mainTitle', event.target.value)}
              />
            </label>
            <div className="podcast-style-field-grid">
              <label>
                Układ
                <select
                  value={settings.coverLayout}
                  onChange={(event) => updateSetting('coverLayout', event.target.value as CoverLayout)}
                >
                  <option value="arc">Arc + center</option>
                  <option value="stack">Stack</option>
                  <option value="lower">Only title</option>
                </select>
              </label>
              <label>
                Widok preview
                <select
                  value={settings.previewMode}
                  onChange={(event) => updateSetting('previewMode', event.target.value as PreviewMode)}
                >
                  <option value="title">Title frame</option>
                  <option value="captions">Captions frame</option>
                </select>
              </label>
            </div>
            <div className="podcast-style-range-grid">
              <RangeControl label="Tytuł" value={settings.titleSize} min={28} max={58} suffix="px" onChange={(value) => updateSetting('titleSize', value)} note={fittedTitleSize < settings.titleSize ? `auto ${fittedTitleSize}px` : undefined} />
              <RangeControl label="Margines L/R" value={settings.titleMarginX} min={0} max={46} suffix="px" onChange={(value) => updateSetting('titleMarginX', value)} />
              <RangeControl label="Środek Y" value={settings.titleOffsetY} min={-450} max={450} suffix="px" onChange={(value) => updateSetting('titleOffsetY', value)} signed />
              <RangeControl label="Góra" value={settings.arcSize} min={18} max={42} suffix="px" onChange={(value) => updateSetting('arcSize', value)} />
              <RangeControl label="Łuk Y" value={settings.arcOffsetY} min={-28} max={40} suffix="px" onChange={(value) => updateSetting('arcOffsetY', value)} signed />
              <RangeControl label="Łuk margines" value={settings.arcMargin} min={0} max={96} suffix="px" onChange={(value) => updateSetting('arcMargin', value)} />
              <RangeControl label="Łuk szerokość" value={settings.arcWidth} min={240} max={560} onChange={(value) => updateSetting('arcWidth', value)} />
              <RangeControl label="Wygięcie" value={settings.arcBend} min={8} max={132} onChange={(value) => updateSetting('arcBend', value)} />
              <RangeControl label="Podpis" value={settings.scriptSize} min={16} max={42} suffix="px" onChange={(value) => updateSetting('scriptSize', value)} />
              <ColorControl label="Kolor" value={settings.titleColor} onChange={(value) => updateSetting('titleColor', value)} />
              <ColorControl label="Obrys" value={settings.titleOutlineColor} onChange={(value) => updateSetting('titleOutlineColor', value)} />
              <ColorControl label="Podpis" value={settings.scriptColor} onChange={(value) => updateSetting('scriptColor', value)} />
            </div>
          </section>
        </div>

        <aside className="podcast-style-preview-column">
          <section className="podcast-style-preview-panel">
            <div className="podcast-style-panel-head">
              <h3>Live preview</h3>
              <span>9:16</span>
            </div>
            <div
              ref={stageRef}
              className={`podcast-style-stage ${titleMode ? 'title-mode' : 'caption-mode'}`}
              style={
                {
                  '--caption-color': settings.captionColor,
                  '--caption-active': settings.captionActiveColor,
                  '--caption-outline': settings.captionOutlineColor,
                  '--caption-size': `${settings.captionSize}px`,
                  '--caption-font': activeFont.stack,
                  '--wave-color': settings.waveColor,
                  '--title-color': settings.titleColor,
                  '--title-outline': settings.titleOutlineColor,
                  '--title-margin-x': `${settings.titleMarginX}px`,
                  '--title-offset-y': `${settings.titleOffsetY}px`,
                  '--arc-size': `${settings.arcSize}px`,
                  '--arc-stroke': `${Math.max(4, Math.round(settings.arcSize * 0.24))}px`,
                  '--arc-top': `${settings.arcOffsetY}px`,
                  '--script-color': settings.scriptColor,
                  '--script-size': `${settings.scriptSize}px`,
                } as React.CSSProperties
              }
            >
              <div
                className="podcast-style-poster"
                role="img"
                aria-label="Aktualny cover podcast video"
                style={{ backgroundImage: `url("${coverUrl}")` }}
              />
              <div className="podcast-style-poster-shade" />
              <div className="podcast-style-title-mask" />
              <div className={`podcast-style-title-layer layout-${settings.coverLayout}`}>
                {showTopText && (
                  <svg className="podcast-style-arc-svg" viewBox="-64 -46 488 158" role="img" aria-label="Górny tytuł covera">
                    <path id="podcast-style-arc-path" d={`M ${arcStartX} 82 Q 180 ${arcControlY} ${arcEndX} 82`} fill="none" />
                    <text className="podcast-style-arc-text" textAnchor="middle">
                      <textPath href="#podcast-style-arc-path" startOffset="50%" textLength={settings.arcWidth} lengthAdjust="spacingAndGlyphs">
                        {settings.topText}
                      </textPath>
                    </text>
                  </svg>
                )}
                {showScriptText && (
                  <div className="podcast-style-script">{settings.scriptText}</div>
                )}
                <div ref={mainTitleRef} className="podcast-style-main-title" style={{ fontSize: fittedTitleSize }}>
                  {titleWords.map((word, index) => (
                    <span key={`${word}-${index}`} className="podcast-style-title-line">
                      {word}
                    </span>
                  ))}
                </div>
              </div>
              <div className={`podcast-style-caption caption-${settings.captionStyle}`}>
                <span>Automatyzacja</span>
                <br />
                <span className="active">marketingu</span>
              </div>
              <div className="podcast-style-wave" aria-hidden="true">
                {Array.from({ length: 34 }).map((_, index) => (
                  <span key={index} style={{ height: `${18 + ((index * 17) % 42)}px` }} />
                ))}
              </div>
              <div className="podcast-style-timeline">
                <span>00:21</span>
                <div><i /></div>
                <span>01:04</span>
              </div>
            </div>
          </section>

          <div className="podcast-style-status">{status}</div>
        </aside>
      </div>
    </section>
  );
}

type RangeControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  signed?: boolean;
  note?: string;
  onChange: (value: number) => void;
};

function RangeControl({
  label,
  value,
  min,
  max,
  suffix = '',
  signed = false,
  note,
  onChange,
}: RangeControlProps) {
  const displayValue = `${signed && value > 0 ? '+' : ''}${rangeValue(value, suffix)}`;
  return (
    <label className="podcast-style-control">
      <span>
        <strong>{label}</strong>
        <em>{note || displayValue}</em>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

type ColorControlProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

function ColorControl({ label, value, onChange }: ColorControlProps) {
  return (
    <label className="podcast-style-control">
      <span>
        <strong>{label}</strong>
        <em>{value.toUpperCase()}</em>
      </span>
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
      />
    </label>
  );
}
