import { generateStems, generateIndividualSegments } from '../src/lib/podcast-video/audio-splitter';
import { PodcastConversationItem } from '../src/lib/podcast-video/types';
import path from 'path';
import { promises as fs } from 'fs';

async function testRealJob() {
  const jobId = 'podcast_video_1774474453344_nbv9ro';
  console.log(`--- Rozpoczynam test na prawdziwym zadaniu: ${jobId} ---`);
  
  const jobDir = path.join(process.cwd(), 'archive', 'podcast-video', jobId);
  const testOutputDir = path.join(process.cwd(), 'test-output-real-job');
  await fs.mkdir(testOutputDir, { recursive: true });
  
  const audioPath = path.join(jobDir, 'audio.mp3');
  const transcriptPath = path.join(jobDir, 'transcript.json');
  
  try {
    const transcript = JSON.parse(await fs.readFile(transcriptPath, 'utf8'));
    
    // Budujemy speakerVoiceMap na podstawie transcriptu
    const speakerVoiceMap = new Map<string, string>();
    const conversation: PodcastConversationItem[] = [];
    
    transcript.speakers.forEach((s: any) => {
      speakerVoiceMap.set(s.name.toLowerCase(), s.voice_id);
    });
    
    // Budujemy liste voiceSegments i konwersacje
    const voiceSegments = transcript.segments.map((seg: any) => ({
      voiceId: seg.voice_id,
      startTimeSeconds: seg.start_time,
      endTimeSeconds: seg.end_time
    }));
    
    transcript.segments.forEach((seg: any) => {
      conversation.push({ speaker: seg.speaker, text: seg.text });
    });

    const paths = {
      stem1: path.join(testOutputDir, 'stem_antoni.mp3'),
      stem2: path.join(testOutputDir, 'stem_zofia.mp3'),
      segments: path.join(testOutputDir, 'segments')
    };

    console.log('1. Generowanie Stemów z rzeczywistymi danymi...');
    await generateStems(
      audioPath,
      voiceSegments,
      conversation,
      speakerVoiceMap,
      paths.stem1,
      paths.stem2
    );

    console.log('2. Generowanie Indywidualnych Segmentów z rzeczywistymi danymi...');
    const segments = await generateIndividualSegments(
      audioPath,
      voiceSegments,
      conversation,
      speakerVoiceMap,
      paths.segments
    );
    
    console.log('--- WYNIKI TESTU RZECZYWISTEGO ---');
    console.log('Liczba wygenerowanych segmentów:', segments.length);
    console.log('Przykładowe nazwy plików:', segments.slice(0, 5));
    
    const segmentFiles = await fs.readdir(paths.segments);
    console.log('Pliki w folderze segments:', segmentFiles.sort());
    
    if (segmentFiles.length === voiceSegments.length) {
      console.log('SUKCES: Liczba plików zgadza się z liczbą segmentów w transkrypcie.');
    } else {
      console.log('OSTRZEŻENIE: Liczba plików różni się od oczekiwanej.');
    }

  } catch (error) {
    console.error('TEST REAL JOB FAILED:', error);
  }
}

testRealJob();
