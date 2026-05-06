import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { promises as fs } from 'fs';
import { PodcastConversationItem } from './types';

interface InternalSegment {
  speaker: string;
  voiceId: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
}

interface ExternalVoiceSegment {
  voice_id?: string | null;
  voiceId?: string | null;
  start_time_seconds?: number | null;
  startTimeSeconds?: number | null;
  end_time_seconds?: number | null;
  endTimeSeconds?: number | null;
}

function normalizeSpeakerKey(s: string) {
  return s.trim().toLowerCase();
}

/**
 * Generates two continuous stems (MP3 files of total duration),
 * muting the other speaker in each.
 */
export async function generateStems(
  inputAudioPath: string,
  voiceSegments: ExternalVoiceSegment[],
  conversation: PodcastConversationItem[],
  speakerVoiceMap: Map<string, string>,
  outputStem1: string,
  outputStem2: string
): Promise<void> {
  const reverseSpeakerMap = new Map<string, string>();
  for (const [key, voiceId] of speakerVoiceMap.entries()) {
    reverseSpeakerMap.set(voiceId, key);
  }

  const segments: InternalSegment[] = (voiceSegments || []).map((seg) => {
    const voiceId = seg.voice_id || seg.voiceId || '';
    return {
      speaker: reverseSpeakerMap.get(voiceId) || 'speaker1',
      voiceId,
      startTimeSeconds: seg.start_time_seconds ?? seg.startTimeSeconds ?? 0,
      endTimeSeconds: seg.end_time_seconds ?? seg.endTimeSeconds ?? 0,
    };
  });

  const distinctSpeakers: string[] = [];
  for (const item of conversation) {
    const key = normalizeSpeakerKey(item.speaker);
    if (!distinctSpeakers.includes(key)) {
      distinctSpeakers.push(key);
    }
  }
  
  const speaker1Key = distinctSpeakers[0] || 'speaker1';

  const speaker2Segments = segments.filter(
    (s) => normalizeSpeakerKey(s.speaker) !== speaker1Key
  );
  const speaker1Segments = segments.filter(
    (s) => normalizeSpeakerKey(s.speaker) === speaker1Key
  );

  const buildEnableExpression = (segs: InternalSegment[]) => {
    if (segs.length === 0) return '0';
    return segs
      .map(s => `between(t,${s.startTimeSeconds.toFixed(3)},${s.endTimeSeconds.toFixed(3)})`)
      .join('+');
  };

  const exprMuteSpk2 = buildEnableExpression(speaker2Segments);
  const exprMuteSpk1 = buildEnableExpression(speaker1Segments);

  const runFfmpeg = (muteExpr: string, outputPath: string) => {
    return new Promise<void>((resolve, reject) => {
      const filter = muteExpr === '0' ? 'volume=1' : `volume=0:enable='${muteExpr}'`;
      ffmpeg(inputAudioPath)
        .audioFilters(filter)
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });
  };

  await Promise.all([
    runFfmpeg(exprMuteSpk2, outputStem1),
    runFfmpeg(exprMuteSpk1, outputStem2),
  ]);
}

/**
 * Splits the audio into individual chunks for each conversation turn.
 * Naming convention: k1, m2, k3, m4... (based on sequence and gender)
 */
export async function generateIndividualSegments(
  inputAudioPath: string,
  voiceSegments: ExternalVoiceSegment[],
  conversation: PodcastConversationItem[],
  speakerVoiceMap: Map<string, string>,
  outputDir: string
): Promise<string[]> {
  await fs.mkdir(outputDir, { recursive: true });

  const reverseSpeakerMap = new Map<string, string>();
  for (const [key, voiceId] of speakerVoiceMap.entries()) {
    reverseSpeakerMap.set(voiceId, key);
  }

  // Pre-determine genders for speakers
  // Assuming voice1 is male (m) and voice2 is female (k) unless we have better data
  // But let's look at Speaker1 mapping from orchestrator logic:
  // if (isFirstVoice) -> 'male' else 'female'
  const speakerToGender = new Map<string, 'k' | 'm'>();
  const distinctSpeakers: string[] = [];
  for (const item of conversation) {
    const key = normalizeSpeakerKey(item.speaker);
    if (!distinctSpeakers.includes(key)) {
      distinctSpeakers.push(key);
    }
  }

  const voice1 = Array.from(speakerVoiceMap.values())[0]; // Usually Antoni
  
  distinctSpeakers.forEach((speakerKey) => {
    const vId = speakerVoiceMap.get(speakerKey);
    // If it's the first voice (Antoni/voice1), it's 'm', else 'k'
    const gender = (vId === voice1) ? 'm' : 'k';
    speakerToGender.set(speakerKey, gender);
  });

  const segments: InternalSegment[] = (voiceSegments || []).map((seg) => {
    const voiceId = seg.voice_id || seg.voiceId || '';
    const speakerKey = reverseSpeakerMap.get(voiceId) || 'speaker1';
    return {
      speaker: speakerKey,
      voiceId,
      startTimeSeconds: seg.start_time_seconds ?? seg.startTimeSeconds ?? 0,
      endTimeSeconds: seg.end_time_seconds ?? seg.endTimeSeconds ?? 0,
    };
  });

  const generatedFiles: string[] = [];

  // Cut each segment
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const index = i + 1;
    const paddedIndex = index.toString().padStart(2, '0');
    const gender = speakerToGender.get(normalizeSpeakerKey(seg.speaker)) || 'm';
    const fileName = `${paddedIndex}_${gender}.mp3`;
    const outputPath = path.join(outputDir, fileName);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputAudioPath)
        .setStartTime(seg.startTimeSeconds)
        .setDuration(seg.endTimeSeconds - seg.startTimeSeconds)
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    generatedFiles.push(fileName);
  }

  return generatedFiles;
}
