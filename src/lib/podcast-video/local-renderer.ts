import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { NormalizedTranscript } from '@/lib/transcript-parser';
import type { PodcastVideoCaptionSettings } from '@/lib/podcast-video/types';

const execFileAsync = promisify(execFile);

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const OUTPUT_FPS = 12;
const OUTPUT_AUDIO_BITRATE = '192k';
const FONT_FAMILY = 'DejaVu Sans';
const SAFE_MARGIN_X = 140;
const DEFAULT_MARGIN_V = 680;
const HIGHLIGHT_VISIBLE_WORDS = 1;
const EDGE_PUNCTUATION_PATTERN =
  /^[.,!?;:()[\]{}"„”'«»]+|[.,!?;:()[\]{}"„”'«»]+$/g;

interface HighlightToken {
  id: number;
  segmentId: number;
  text: string;
  normalizedText: string;
  startTime: number;
  endTime: number;
}

interface CueGroup {
  startTime: number;
  endTime: number;
  lines: HighlightToken[][];
}

export interface LocalPodcastRenderResult {
  assPath: string;
  outputPath: string;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toCaptionCase(value: string): string {
  return value.toLocaleUpperCase('pl-PL');
}

function normalizeSeconds(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}

function formatAssTime(seconds: number): string {
  const totalCs = Math.round(normalizeSeconds(seconds) * 100);
  const cs = totalCs % 100;
  const totalSeconds = Math.floor(totalCs / 100);
  const ss = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mm = totalMinutes % 60;
  const hh = Math.floor(totalMinutes / 60);

  return `${hh}:${mm.toString().padStart(2, '0')}:${ss
    .toString()
    .padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

function escapeAssText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\n/g, '\\N');
}

function hexToAssColor(hex: string): string {
  const cleaned = hex.replace('#', '').toUpperCase();
  const rr = cleaned.slice(0, 2);
  const gg = cleaned.slice(2, 4);
  const bb = cleaned.slice(4, 6);
  return `&H00${bb}${gg}${rr}&`;
}

function normalizeComparableToken(value: string): string {
  return normalizeText(value)
    .replace(EDGE_PUNCTUATION_PATTERN, '')
    .toLowerCase();
}

function buildLineLimits(fontSize: number) {
  if (fontSize >= 88) {
    return { maxWordsPerLine: 4, maxCharsPerLine: 24 };
  }
  if (fontSize >= 72) {
    return { maxWordsPerLine: 5, maxCharsPerLine: 30 };
  }
  return { maxWordsPerLine: 6, maxCharsPerLine: 36 };
}

function splitTokensIntoLines<T extends { text: string }>(
  tokens: T[],
  fontSize: number
): T[][] {
  const { maxWordsPerLine, maxCharsPerLine } = buildLineLimits(fontSize);
  const lines: T[][] = [];
  let currentLine: T[] = [];
  let currentLength = 0;

  for (const token of tokens) {
    const nextLength = currentLength + token.text.length + (currentLine.length ? 1 : 0);
    const exceedsWords = currentLine.length >= maxWordsPerLine;
    const exceedsChars = currentLine.length > 0 && nextLength > maxCharsPerLine;

    if (currentLine.length > 0 && (exceedsWords || exceedsChars)) {
      lines.push(currentLine);
      currentLine = [];
      currentLength = 0;
    }

    currentLine.push(token);
    currentLength += token.text.length + (currentLine.length > 1 ? 1 : 0);
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [[]];
}

function groupLinesIntoCues<T extends { text: string }>(
  lines: T[][],
  getTimes: (group: T[][]) => { startTime: number; endTime: number }
): Array<{ lines: T[][]; startTime: number; endTime: number }> {
  const groups: Array<{ lines: T[][]; startTime: number; endTime: number }> = [];

  for (let index = 0; index < lines.length; index += 2) {
    const group = lines.slice(index, index + 2);
    groups.push({
      lines: group,
      ...getTimes(group),
    });
  }

  return groups;
}

function renderHighlightedText(
  lines: HighlightToken[][],
  activeWordId: number,
  lineColor: string,
  wordColor: string
): string {
  const activeColor = hexToAssColor(wordColor);
  const inactiveColor = hexToAssColor(lineColor);
  const flattened = lines.flat();
  const activeIndex = flattened.findIndex((token) => token.id === activeWordId);

  if (activeIndex < 0) {
    return '';
  }

  const visibleStartIndex = Math.max(0, activeIndex - (HIGHLIGHT_VISIBLE_WORDS - 1));
  const visibleIds = new Set(
    flattened.slice(visibleStartIndex, activeIndex + 1).map((token) => token.id)
  );

  return lines
    .map((line) =>
      line
        .filter((token) => visibleIds.has(token.id))
        .map((token) => {
          const displayText = escapeAssText(toCaptionCase(token.text));
          if (token.id === activeWordId) {
            return `{\\c${activeColor}}${displayText}{\\c${inactiveColor}}`;
          }
          return displayText;
        })
        .join('\\N')
    )
    .filter((line) => line.length > 0)
    .join('\\N');
}

function buildAssHeader(settings: PodcastVideoCaptionSettings): string {
  const primaryColor = hexToAssColor(settings.line_color);
  const outlineColor = hexToAssColor(settings.outline_color);

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${OUTPUT_WIDTH}`,
    `PlayResY: ${OUTPUT_HEIGHT}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 2',
    'Collisions: Normal',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${FONT_FAMILY},${settings.font_size},${primaryColor},${primaryColor},${outlineColor},&H00000000&,1,0,0,0,100,100,0,0,1,4,0,2,${SAFE_MARGIN_X},${SAFE_MARGIN_X},${DEFAULT_MARGIN_V},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
}

function buildSegmentHighlightTokens(transcript: NormalizedTranscript): HighlightToken[] {
  return transcript.words
    .map((word) => ({
      id: word.id,
      segmentId: word.segment_id,
      text: normalizeText(word.text),
      normalizedText: normalizeComparableToken(word.text),
      startTime: normalizeSeconds(word.start_time),
      endTime: normalizeSeconds(Math.max(word.start_time, word.end_time)),
    }))
    .filter((word) => word.text.length > 0)
    .sort((left, right) => {
      if (left.startTime !== right.startTime) {
        return left.startTime - right.startTime;
      }
      return left.id - right.id;
    });
}

function matchSegmentTokens(
  transcript: NormalizedTranscript,
  fontSize: number
): CueGroup[] {
  const words = buildSegmentHighlightTokens(transcript);
  const wordsBySegment = new Map<number, HighlightToken[]>();

  for (const word of words) {
    const list = wordsBySegment.get(word.segmentId) || [];
    list.push(word);
    wordsBySegment.set(word.segmentId, list);
  }

  const cues: CueGroup[] = [];

  for (const segment of transcript.segments) {
    const segmentWords = wordsBySegment.get(segment.id) || [];
    if (!segmentWords.length) {
      continue;
    }

    const rawTokens = normalizeText(segment.text).split(' ').filter(Boolean);
    const displayTokens: HighlightToken[] = [];
    let wordIndex = 0;

    for (const token of rawTokens) {
      const word = segmentWords[wordIndex];
      if (!word) {
        break;
      }

      const normalizedToken = normalizeComparableToken(token);
      const normalizedWord = word.normalizedText;

      if (
        normalizedToken === normalizedWord ||
        normalizedToken.includes(normalizedWord) ||
        normalizedWord.includes(normalizedToken)
      ) {
        displayTokens.push({
          ...word,
          text: token,
        });
        wordIndex += 1;
        continue;
      }

      displayTokens.push({
        ...word,
        text: token,
      });
      wordIndex += 1;
    }

    while (wordIndex < segmentWords.length) {
      displayTokens.push(segmentWords[wordIndex]);
      wordIndex += 1;
    }

    const lines = splitTokensIntoLines(displayTokens, fontSize);
    const grouped = groupLinesIntoCues(lines, (groupLines) => {
      const flat = groupLines.flat();
      return {
        startTime: flat[0]?.startTime ?? normalizeSeconds(segment.start_time),
        endTime: flat.at(-1)?.endTime ?? normalizeSeconds(segment.end_time),
      };
    });

    for (const group of grouped) {
      cues.push({
        startTime: group.startTime,
        endTime: group.endTime,
        lines: group.lines,
      });
    }
  }

  return cues;
}

function buildHighlightAss(
  transcript: NormalizedTranscript,
  settings: PodcastVideoCaptionSettings
): string {
  const cues = matchSegmentTokens(transcript, settings.font_size);
  const lines: string[] = [buildAssHeader(settings)];

  for (const cue of cues) {
    const flatTokens = cue.lines.flat();
    for (let index = 0; index < flatTokens.length; index += 1) {
      const token = flatTokens[index];
      const nextToken = flatTokens[index + 1];
      const start = token.startTime;
      const end = normalizeSeconds(
        Math.max(token.endTime, nextToken?.startTime ?? cue.endTime)
      );
      if (end <= start) {
        continue;
      }

      lines.push(
        `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,${DEFAULT_MARGIN_V},,${renderHighlightedText(
          cue.lines,
          token.id,
          settings.line_color,
          settings.word_color
        )}`
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

function buildClassicAss(
  transcript: NormalizedTranscript,
  settings: PodcastVideoCaptionSettings
): string {
  const lines: string[] = [buildAssHeader(settings)];

  for (const segment of transcript.segments) {
    const textTokens = normalizeText(segment.text)
      .split(' ')
      .filter(Boolean)
      .map((token, index) => ({
        id: index,
        text: token,
      }));

    const segmentLines = splitTokensIntoLines(textTokens, settings.font_size);
    const groups = groupLinesIntoCues(segmentLines, (groupLines) => {
      const totalTokens = segmentLines.flat().length || 1;
      const groupedTokenCount = groupLines.flat().length || 1;
      const allGroups = Math.max(1, Math.ceil(segmentLines.length / 2));
      const groupIndex = Math.floor(segmentLines.indexOf(groupLines[0]) / 2);
      const segmentStart = normalizeSeconds(segment.start_time);
      const segmentEnd = normalizeSeconds(segment.end_time);
      const segmentDuration = Math.max(0.12, segmentEnd - segmentStart);
      const averageDuration = segmentDuration / allGroups;

      if (totalTokens <= groupedTokenCount || allGroups === 1) {
        return {
          startTime: segmentStart,
          endTime: segmentEnd,
        };
      }

      const startTime = normalizeSeconds(segmentStart + averageDuration * groupIndex);
      const endTime =
        groupIndex === allGroups - 1
          ? segmentEnd
          : normalizeSeconds(segmentStart + averageDuration * (groupIndex + 1));

      return { startTime, endTime };
    });

    for (const group of groups) {
      const text = group.lines
        .map((line) => line.map((token) => escapeAssText(toCaptionCase(token.text))).join(' '))
        .join('\\N');
      lines.push(
        `Dialogue: 0,${formatAssTime(group.startTime)},${formatAssTime(group.endTime)},Default,,0,0,${DEFAULT_MARGIN_V},,${text}`
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

async function ensureFfmpegAvailable(): Promise<void> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
  } catch (error) {
    throw new Error(
      `Local ffmpeg renderer is unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function runFfmpegRender(args: {
  imagePath: string;
  audioPath: string;
  assPath: string;
  outputPath: string;
}): Promise<void> {
  const subtitleFilter = [
    `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
    `ass=${args.assPath}`,
  ].join(',');

  await execFileAsync('ffmpeg', [
    '-y',
    '-loop',
    '1',
    '-i',
    args.imagePath,
    '-i',
    args.audioPath,
    '-vf',
    subtitleFilter,
    '-r',
    String(OUTPUT_FPS),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'stillimage',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    OUTPUT_AUDIO_BITRATE,
    '-shortest',
    args.outputPath,
  ]);
}

export async function renderPodcastVideoLocally(args: {
  imagePath: string;
  audioPath: string;
  outputPath: string;
  transcript: NormalizedTranscript;
  settings: PodcastVideoCaptionSettings;
  mode: 'highlight_exact' | 'classic_exact';
}): Promise<LocalPodcastRenderResult> {
  await ensureFfmpegAvailable();

  const assPath = path.join(path.dirname(args.outputPath), 'captions.ass');
  const assContent =
    args.mode === 'highlight_exact'
      ? buildHighlightAss(args.transcript, args.settings)
      : buildClassicAss(args.transcript, args.settings);

  await fs.mkdir(path.dirname(args.outputPath), { recursive: true });
  await fs.writeFile(assPath, assContent, 'utf8');

  await runFfmpegRender({
    imagePath: args.imagePath,
    audioPath: args.audioPath,
    assPath,
    outputPath: args.outputPath,
  });

  return {
    assPath,
    outputPath: args.outputPath,
  };
}
