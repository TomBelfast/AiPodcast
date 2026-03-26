import type { NormalizedTranscript } from '@/lib/transcript-parser';

function normalizeSeconds(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}

function toCaptionCase(value: string): string {
  return value.toLocaleUpperCase('pl-PL');
}

export function hasWordTimings(transcript: NormalizedTranscript): boolean {
  return Array.isArray(transcript.words) && transcript.words.length > 0;
}

export function formatSrtTime(seconds: number): string {
  const totalMs = Math.round(normalizeSeconds(seconds) * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const ss = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mm = totalMinutes % 60;
  const hh = Math.floor(totalMinutes / 60);

  return `${hh.toString().padStart(2, '0')}:${mm
    .toString()
    .padStart(2, '0')}:${ss.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

export function buildExactSrt(transcript: NormalizedTranscript): string {
  if (!Array.isArray(transcript.segments) || transcript.segments.length === 0) {
    return '';
  }

  return transcript.segments
    .map((segment, index) => {
      const start = formatSrtTime(segment.start_time);
      const end = formatSrtTime(segment.end_time);
      const text = toCaptionCase((segment.text || '').replace(/\s+/g, ' ').trim());
      return `${index + 1}\n${start} --> ${end}\n${text}\n`;
    })
    .join('\n');
}
