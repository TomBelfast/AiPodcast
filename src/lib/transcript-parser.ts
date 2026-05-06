/**
 * Podcast AI - Transcript Parser for ElevenLabs
 * Deterministic parser for converting ElevenLabs JSON to normalized Transcript format
 */

export interface Speaker {
  id: string;
  name: string;
  voice_id: string | null;
  gender: string | null;
  personality: string | null;
}

export interface Segment {
  id: number;
  speaker: string | null;
  voice_id: string | null;
  dialogue_input_index: number | null;
  start_time: number;
  end_time: number;
  text: string;
}

export interface Word {
  id: number;
  segment_id: number;
  speaker: string | null;
  voice_id: string | null;
  text: string;
  start_time: number;
  end_time: number;
}

export interface NormalizedTranscript {
  source: string;
  version: 1;
  job_id: string | null;
  title: string | null;
  audio_filename: string | null;
  timestamp: string | null;
  duration_seconds: number;
  full_text: string;
  speakers: Speaker[];
  segments: Segment[];
  words: Word[];
  srt: string;
  warnings: string[];
}

interface TranscriptAlignment {
  characters?: string[];
  characterStartTimesSeconds?: number[];
  characterEndTimesSeconds?: number[];
}

interface ValidTranscriptAlignment {
  characters: string[];
  characterStartTimesSeconds: number[];
  characterEndTimesSeconds: number[];
}

interface TranscriptVoiceSegment {
  speaker?: string | null;
  voiceId?: string | null;
  dialogueInputIndex?: number | null;
  characterStartIndex?: number | null;
  characterEndIndex?: number | null;
  startTimeSeconds?: number | null;
  endTimeSeconds?: number | null;
}

interface TranscriptConversationItem {
  text?: string;
}

interface TranscriptSpeakerMetadata {
  name?: string;
  voiceId?: string | null;
  gender?: string | null;
  personality?: string | null;
}

interface ElevenLabsTranscriptInput {
  jobId?: string | null;
  title?: string | null;
  audioFilename?: string | null;
  timestamp?: string | null;
  speakers?: Record<string, TranscriptSpeakerMetadata>;
  conversation?: TranscriptConversationItem[];
  voiceSegments?: TranscriptVoiceSegment[];
  alignment?: TranscriptAlignment | null;
  normalizedAlignment?: TranscriptAlignment | null;
}

function formatSrtTime(seconds: number): string {
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const ss = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mm = totalMinutes % 60;
  const hh = Math.floor(totalMinutes / 60);

  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

function isValidAlignment(alignment: TranscriptAlignment | null | undefined): alignment is ValidTranscriptAlignment {
  return Boolean(
    alignment &&
      Array.isArray(alignment.characters) &&
      Array.isArray(alignment.characterStartTimesSeconds) &&
      Array.isArray(alignment.characterEndTimesSeconds) &&
      alignment.characters.length === alignment.characterStartTimesSeconds.length &&
      alignment.characters.length === alignment.characterEndTimesSeconds.length
  );
}

export function parseElevenLabsTranscript(input: ElevenLabsTranscriptInput): NormalizedTranscript {
  const warnings: string[] = [];
  const alignmentCandidate = input.normalizedAlignment || input.alignment;

  if (!alignmentCandidate) {
    warnings.push("brak alignment i words będzie puste");
  } else if (!isValidAlignment(alignmentCandidate)) {
    warnings.push("lengths alignment.characters, characterStartTimesSeconds, characterEndTimesSeconds się nie zgadzają");
  }
  const alignment = isValidAlignment(alignmentCandidate) ? alignmentCandidate : null;

  // Parse Speakers
  const speakers: Speaker[] = [];
  if (input.speakers) {
    for (const [id, data] of Object.entries(input.speakers)) {
      speakers.push({
        id: id,
        name: data.name ?? id,
        voice_id: data.voiceId ?? null,
        gender: data.gender ?? null,
        personality: data.personality ?? null
      });
    }
  }

  // Parse Segments
  const segments: Segment[] = [];
  if (input.voiceSegments) {
    input.voiceSegments.forEach((vs, idx) => {
      let text = "";
      const dialogueInputIndex = vs.dialogueInputIndex;

      if (dialogueInputIndex !== null && dialogueInputIndex !== undefined && input.conversation && input.conversation[dialogueInputIndex]) {
        text = input.conversation[dialogueInputIndex].text ?? "";
      } else {
        warnings.push(`dialogueInputIndex jest niepoprawny dla segmentu ${idx}`);
        if (alignment) {
          const characterStartIndex = vs.characterStartIndex ?? 0;
          const characterEndIndex = vs.characterEndIndex ?? characterStartIndex;
          text = alignment.characters.slice(characterStartIndex, characterEndIndex).join("");
        }
      }

      text = text.replace(/\s+/g, " ").trim();
      if (!text) {
        warnings.push(`segment ${idx} ma pusty text`);
      }

      const startTime = vs.startTimeSeconds ?? 0;
      const endTime = vs.endTimeSeconds ?? startTime;
      if (vs.startTimeSeconds == null || vs.endTimeSeconds == null || startTime > endTime) {
        warnings.push(`segment ${idx} ma brakujące lub nielogiczne czasy`);
      }

      segments.push({
        id: idx,
        speaker: vs.speaker ?? null,
        voice_id: vs.voiceId ?? null,
        dialogue_input_index: dialogueInputIndex !== undefined ? dialogueInputIndex : null,
        start_time: Math.round(startTime * 1000) / 1000,
        end_time: Math.round(endTime * 1000) / 1000,
        text: text
      });
    });
  }

  // Sort segments by time just in case
  segments.sort((a, b) => a.start_time - b.start_time);

  const full_text = segments.map(s => s.text).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  // Determine Duration
  let duration_seconds = 0;
  if (segments.length > 0) {
    duration_seconds = Math.max(duration_seconds, segments[segments.length - 1].end_time);
  }
  if (alignment && alignment.characterEndTimesSeconds && alignment.characterEndTimesSeconds.length > 0) {
    duration_seconds = Math.max(duration_seconds, alignment.characterEndTimesSeconds[alignment.characterEndTimesSeconds.length - 1]);
  }
  duration_seconds = Math.round(duration_seconds * 1000) / 1000;

  // Build Word Tokens
  const words: Word[] = [];
  if (alignment && input.voiceSegments) {
    let globalWordId = 0;
    const punctuation = '.,!?;:()[]{}"„”\'«»';

    input.voiceSegments.forEach((vs, segIdx) => {
      const start = vs.characterStartIndex ?? 0;
      const end = vs.characterEndIndex ?? start;

      const chars = alignment.characters.slice(start, end);
      const charStarts = alignment.characterStartTimesSeconds.slice(start, end);
      const charEnds = alignment.characterEndTimesSeconds.slice(start, end);

      let buffer: string[] = [];
      let bufferStarts: number[] = [];
      let bufferEnds: number[] = [];

      const processBuffer = () => {
        let startIndex = 0;
        let endIndex = buffer.length - 1;

        // Trim punctuation from left and right
        while (startIndex < buffer.length && punctuation.includes(buffer[startIndex])) {
          startIndex++;
        }
        while (endIndex >= startIndex && punctuation.includes(buffer[endIndex])) {
          endIndex--;
        }

        if (startIndex <= endIndex) {
          const cleanedText = buffer.slice(startIndex, endIndex + 1).join("");
          const startTime = bufferStarts[startIndex];
          let endTime = bufferEnds[endIndex];

          if (endTime < startTime) endTime = startTime;

          words.push({
            id: globalWordId++,
            segment_id: segIdx,
            speaker: vs.speaker ?? null,
            voice_id: vs.voiceId ?? null,
            text: cleanedText,
            start_time: Math.round(startTime * 1000) / 1000,
            end_time: Math.round(endTime * 1000) / 1000
          });
        }

        buffer = [];
        bufferStarts = [];
        bufferEnds = [];
      };

      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        if (/\s/.test(char)) {
          if (buffer.length > 0) {
            processBuffer();
          }
        } else {
          buffer.push(char);
          bufferStarts.push(charStarts[i]);
          bufferEnds.push(charEnds[i]);
        }
      }
      if (buffer.length > 0) {
        processBuffer();
      }
    });
  }

  // Final Words Sort
  words.sort((a, b) => {
    if (a.start_time !== b.start_time) return a.start_time - b.start_time;
    return a.id - b.id;
  });

  // Generate SRT from Segments
  const srt = segments
    .map((s, idx) => {
      const cueIndex = idx + 1;
      const timeRange = `${formatSrtTime(s.start_time)} --> ${formatSrtTime(s.end_time)}`;
      const label = s.speaker ? `${s.speaker}: ` : "";
      return `${cueIndex}\n${timeRange}\n${label}${s.text}\n`;
    })
    .join("\n");

  return {
    source: "elevenlabs",
    version: 1,
    job_id: input.jobId ?? null,
    title: input.title ?? null,
    audio_filename: input.audioFilename ?? null,
    timestamp: input.timestamp ?? null,
    duration_seconds,
    full_text,
    speakers,
    segments,
    words,
    srt,
    warnings
  };
}
