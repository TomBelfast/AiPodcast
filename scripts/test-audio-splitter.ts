import { generateStems, generateIndividualSegments } from '../src/lib/podcast-video/audio-splitter';
import { PodcastConversationItem } from '../src/lib/podcast-video/types';
import path from 'path';
import { promises as fs } from 'fs';

async function testSplitter() {
  console.log('--- Rozpoczynam test lokalny audio-splittera ---');
  
  const testDir = path.join(process.cwd(), 'test-output-audio');
  await fs.mkdir(testDir, { recursive: true });
  
  // Sciezka do istniejacego MP3 (uzywam znalezionego wczesniej pliku)
  const sourceMp3 = path.join(process.cwd(), 'podcast_final_fix_1774468057040.mp3');
  
  // Dane testowe
  const conversation: PodcastConversationItem[] = [
    { speaker: 'Zofia', text: 'Czesc Antoni, co tam slychac?' },
    { speaker: 'Antoni', text: 'A wiesz Zofia, wlasnie testuje nowa funkcje ciecia audio.' },
    { speaker: 'Zofia', text: 'To brzmi niesamowicie, pokaż jak to działa!' }
  ];

  const speakerVoiceMap = new Map<string, string>([
    ['antoni', 'nPczCjzI2devNBz1zQrb'], // m (voice1)
    ['zofia', 'EXAVITQu4vr4xnSDxMaL']   // k (voice2)
  ]);

  // Symulacja voice_segments z ElevenLabs
  const voiceSegments = [
    { 
      voiceId: 'EXAVITQu4vr4xnSDxMaL', // Zofia
      start_time_seconds: 0.0,
      end_time_seconds: 2.5
    },
    { 
      voiceId: 'nPczCjzI2devNBz1zQrb', // Antoni
      start_time_seconds: 2.5,
      end_time_seconds: 6.0
    },
    { 
      voiceId: 'EXAVITQu4vr4xnSDxMaL', // Zofia
      start_time_seconds: 6.0,
      end_time_seconds: 9.0
    }
  ];

  const paths = {
    stem1: path.join(testDir, 'stem_m.mp3'),
    stem2: path.join(testDir, 'stem_k.mp3'),
    segments: path.join(testDir, 'segments')
  };

  try {
    console.log('1. Generowanie Stemów...');
    await generateStems(
      sourceMp3,
      voiceSegments,
      conversation,
      speakerVoiceMap,
      paths.stem1,
      paths.stem2
    );
    console.log('   OK: Stemy wygenerowane.');

    console.log('2. Generowanie Indywidualnych Segmentów...');
    const segments = await generateIndividualSegments(
      sourceMp3,
      voiceSegments,
      conversation,
      speakerVoiceMap,
      paths.segments
    );
    console.log('   OK: Segmenty wygenerowane:', segments);

    // Sprawdzanie plikow
    const stem1Exists = await fs.access(paths.stem1).then(() => true).catch(() => false);
    const stem2Exists = await fs.access(paths.stem2).then(() => true).catch(() => false);
    const segmentFiles = await fs.readdir(paths.segments);

    console.log('\n--- WYNIKI TESTU ---');
    console.log('Lokalizacja testowa:', testDir);
    console.log('Stem Męski (Antoni):', stem1Exists ? 'ZNALEZIONO' : 'BRAK');
    console.log('Stem Żeński (Zofia):', stem2Exists ? 'ZNALEZIONO' : 'BRAK');
    console.log('Pliki w folderze segments:', segmentFiles);
    
    if (segmentFiles.includes('k1.mp3') && segmentFiles.includes('m2.mp3') && segmentFiles.includes('k3.mp3')) {
      console.log('SUKCES: Nazewnictwo k1, m2, k3... jest poprawne.');
    } else {
      console.log('BŁĄD: Nazewnictwo plikow nie zgadza sie z oczekiwaniami.');
    }

  } catch (error) {
    console.error('TEST FAILED:', error);
  }
}

testSplitter();
