export type DisplayToken = {
  id: number;
  segmentIndex: number;
  text: string;
  startTime: number;
  endTime: number;
};

export type SegmentCaptionTiming = {
  segmentIndex: number;
  text: string;
  startTime: number;
  endTime: number;
};

export type ClassicCueGroup = {
  segmentIndex: number;
  startTime: number;
  endTime: number;
  lines: string[];
};

export type CaptionStyle = {
  fontSize: number;
  lineColor: string;
  wordColor: string;
  outlineColor: string;
  marginV: number;
  marginX: number;
  playResX: number;
  playResY: number;
  fontName: string;
  visibleWords: number;
};

export type DirectClassicAlignmentMode = 'segment_cues' | 'classic_pseudo_token';

const EDGE_PUNCTUATION_PATTERN =
  /^[.,!?;:()[\]{}"„"'«»…–—-]+|[.,!?;:()[\]{}"„"'«»…–—-]+$/g;

export function hexToAssColor(hex: string): string {
  const cleaned = hex.replace('#', '').padStart(6, '0');
  const rr = cleaned.slice(0, 2);
  const gg = cleaned.slice(2, 4);
  const bb = cleaned.slice(4, 6);
  return `&H00${bb}${gg}${rr}&`;
}

export function escapeAssText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\N')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')');
}

export function formatSrtTimestamp(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function formatAssTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.round((total - Math.floor(total)) * 100);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs, 2)}`;
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function foldComparableCharacters(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[łŁ]/g, (char) => (char === 'Ł' ? 'L' : 'l'));
}

export function normalizeComparableToken(value: string): string {
  return foldComparableCharacters(
    normalizeText(value).replace(EDGE_PUNCTUATION_PATTERN, '').toLocaleLowerCase('pl-PL')
  );
}

export function toCaptionCase(value: string): string {
  return value.toLocaleUpperCase('pl-PL');
}

export function buildLineLimits(fontSize: number) {
  if (fontSize >= 88) return { maxWordsPerLine: 4, maxCharsPerLine: 24 };
  if (fontSize >= 72) return { maxWordsPerLine: 5, maxCharsPerLine: 30 };
  if (fontSize >= 48) return { maxWordsPerLine: 6, maxCharsPerLine: 36 };
  return { maxWordsPerLine: 6, maxCharsPerLine: 32 };
}

export function splitTokensIntoLines<T extends { text: string }>(
  tokens: T[],
  fontSize: number
): T[][] {
  const { maxWordsPerLine, maxCharsPerLine } = buildLineLimits(fontSize);
  const lines: T[][] = [];
  let current: T[] = [];
  let currentLength = 0;

  for (const token of tokens) {
    const nextLength = currentLength + token.text.length + (current.length ? 1 : 0);
    const exceedsWords = current.length >= maxWordsPerLine;
    const exceedsChars = current.length > 0 && nextLength > maxCharsPerLine;

    if (current.length > 0 && (exceedsWords || exceedsChars)) {
      lines.push(current);
      current = [];
      currentLength = 0;
    }

    current.push(token);
    currentLength += token.text.length + (current.length > 1 ? 1 : 0);
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines.length ? lines : [[]];
}

export function buildAssHeader(style: CaptionStyle): string {
  const primaryColor = hexToAssColor(style.lineColor);
  const outlineColor = hexToAssColor(style.outlineColor);
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${style.playResX}`,
    `PlayResY: ${style.playResY}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 2',
    'Collisions: Normal',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${style.fontName},${style.fontSize},${primaryColor},${primaryColor},${outlineColor},&H00000000&,1,0,0,0,100,100,0,0,1,2,0,8,${style.marginX},${style.marginX},${style.marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
}

export function buildSegmentCaptionTimings(
  segments: Array<{ text: string; duration_seconds: number }>,
  startOffsetSeconds = 0
): SegmentCaptionTiming[] {
  const timings: SegmentCaptionTiming[] = [];
  let cursor = startOffsetSeconds;

  for (let index = 0; index < segments.length; index += 1) {
    const duration = Math.max(0, Number(segments[index].duration_seconds) || 0);
    timings.push({
      segmentIndex: index,
      text: segments[index].text,
      startTime: cursor,
      endTime: cursor + duration,
    });
    cursor += duration;
  }

  return timings;
}

export function estimateSegmentWordTimings(
  scriptText: string,
  segmentStartTime: number,
  segmentEndTime: number,
  segmentIndex: number,
  idOffset: number
): DisplayToken[] {
  const rawTokens = normalizeText(scriptText).split(' ').filter(Boolean);
  if (rawTokens.length === 0) {
    return [];
  }

  const totalDuration = Math.max(0.12, segmentEndTime - segmentStartTime);
  const weights = rawTokens.map((token) =>
    Math.max(1, normalizeComparableToken(token).length || token.length)
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = segmentStartTime;
  return rawTokens.map((token, index) => {
    const isLast = index === rawTokens.length - 1;
    const sliceDuration = isLast
      ? Math.max(0.04, segmentEndTime - cursor)
      : Math.max(0.04, (totalDuration * weights[index]) / totalWeight);
    const startTime = cursor;
    const endTime = isLast
      ? segmentEndTime
      : Math.min(segmentEndTime, cursor + sliceDuration);
    cursor = endTime;

    return {
      id: idOffset + index,
      segmentIndex,
      text: token,
      startTime,
      endTime,
    };
  });
}

export function buildClassicCueGroupsFromDisplayTokens(
  tokens: DisplayToken[],
  fontSize: number
): ClassicCueGroup[] {
  if (tokens.length === 0) {
    return [];
  }

  const cues: ClassicCueGroup[] = [];
  const tokensBySegment = new Map<number, DisplayToken[]>();

  for (const token of tokens) {
    const list = tokensBySegment.get(token.segmentIndex) || [];
    list.push(token);
    tokensBySegment.set(token.segmentIndex, list);
  }

  for (const segmentTokens of tokensBySegment.values()) {
    const lines = splitTokensIntoLines(segmentTokens, fontSize);

    for (let index = 0; index < lines.length; index += 2) {
      const cueLines = lines.slice(index, index + 2);
      const flat = cueLines.flat();
      if (!flat.length) {
        continue;
      }

      cues.push({
        segmentIndex: segmentTokens[0].segmentIndex,
        startTime: flat[0].startTime,
        endTime: flat[flat.length - 1].endTime,
        lines: cueLines.map((line) => line.map((item) => item.text).join(' ')),
      });
    }
  }

  return cues;
}

export function buildClassicCueGroupsFromTimedSegments(
  segments: SegmentCaptionTiming[],
  fontSize: number
): ClassicCueGroup[] {
  const cues: ClassicCueGroup[] = [];

  for (const segment of segments) {
    const rawTokens = normalizeText(segment.text)
      .split(' ')
      .filter(Boolean)
      .map((token, index) => ({ id: index, text: token }));

    if (rawTokens.length === 0) {
      continue;
    }

    const lines = splitTokensIntoLines(rawTokens, fontSize);
    const cueCount = Math.max(1, Math.ceil(lines.length / 2));
    const duration = Math.max(0.12, segment.endTime - segment.startTime);
    const perCue = duration / cueCount;

    for (let index = 0; index < lines.length; index += 2) {
      const cueIndex = Math.floor(index / 2);
      const cueLines = lines.slice(index, index + 2);
      cues.push({
        segmentIndex: segment.segmentIndex,
        startTime: segment.startTime + perCue * cueIndex,
        endTime:
          cueIndex === cueCount - 1
            ? segment.endTime
            : segment.startTime + perCue * (cueIndex + 1),
        lines: cueLines.map((line) => line.map((token) => token.text).join(' ')),
      });
    }
  }

  return cues;
}

export function buildClassicPseudoCueGroupsFromTimedSegments(
  segments: SegmentCaptionTiming[],
  fontSize: number
): { cues: ClassicCueGroup[]; tokens: DisplayToken[] } {
  const cues: ClassicCueGroup[] = [];
  const tokens: DisplayToken[] = [];
  let tokenId = 0;

  for (const segment of segments) {
    const segmentTokens = estimateSegmentWordTimings(
      segment.text,
      segment.startTime,
      segment.endTime,
      segment.segmentIndex,
      tokenId
    );
    tokenId += segmentTokens.length;
    tokens.push(...segmentTokens);
    cues.push(...buildClassicCueGroupsFromDisplayTokens(segmentTokens, fontSize));
  }

  return { cues, tokens };
}

export function buildSrtFromCueGroups(cues: ClassicCueGroup[]): string {
  const lines: string[] = [];

  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    lines.push(
      String(index + 1),
      `${formatSrtTimestamp(cue.startTime)} --> ${formatSrtTimestamp(cue.endTime)}`,
      toCaptionCase(cue.lines.join('\n')),
      ''
    );
  }

  return lines.join('\n');
}

export function buildClassicAssFromCueGroups(
  cues: ClassicCueGroup[],
  style: CaptionStyle
): string {
  const lines: string[] = [buildAssHeader(style)];

  for (const cue of cues) {
    const text = cue.lines.map((line) => escapeAssText(toCaptionCase(line))).join('\\N');
    if (!text) {
      continue;
    }

    lines.push(
      `Dialogue: 0,${formatAssTime(cue.startTime)},${formatAssTime(cue.endTime)},Default,,0,0,${style.marginV},,${text}`
    );
  }

  return `${lines.join('\n')}\n`;
}
