#!/usr/bin/env node

/**
 * LTX2 PIPELINE SPLITTER
 * Automatycznie dzieli plik audio podcastu na segmenty dla LTX2 na podstawie znormalizowanego JSON-a.
 * 
 * Użycie: node scripts/split-for-ltx.mjs <sciezka_do_jsona>
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const jsonPath = process.argv[2];

if (!jsonPath) {
  console.error('BŁĄD: Podaj ścieżkę do pliku JSON transcriptu.');
  console.log('Przykład: node scripts/split-for-ltx.mjs archive/podcast_xyz.json');
  process.exit(1);
}

const absoluteJsonPath = path.resolve(jsonPath);
const baseDir = path.dirname(absoluteJsonPath);

if (!fs.existsSync(absoluteJsonPath)) {
  console.error(`BŁĄD: Plik nie istnieje: ${absoluteJsonPath}`);
  process.exit(1);
}

// 1. Wczytaj dane
const transcript = JSON.parse(fs.readFileSync(absoluteJsonPath, 'utf8'));
const { job_id, audio_filename, segments, speakers } = transcript;

if (!audio_filename || !segments) {
  console.error('BŁĄD: JSON nie zawiera wymaganych pól (audio_filename, segments).');
  process.exit(1);
}

const audioPath = path.join(baseDir, audio_filename);
if (!fs.existsSync(audioPath)) {
  console.error(`BŁĄD: Nie znaleziono pliku audio: ${audioPath}`);
  process.exit(1);
}

// 2. Przygotuj folder wyjściowy
const exportDirName = `ltx_export_${job_id || Date.now()}`;
const exportDir = path.join(baseDir, exportDirName);

if (!fs.existsSync(exportDir)) {
  fs.mkdirSync(exportDir, { recursive: true });
}

console.log(`\n🚀 Rozpoczynam eksport dla LTX2 do folderu: ${exportDirName}`);
console.log(`📁 Plik źródłowy: ${audio_filename}\n`);

const manifest = {
  job_id,
  source_audio: audio_filename,
  export_timestamp: new Date().toISOString(),
  segments: []
};

// 3. Procesuj segmenty
for (let i = 0; i < segments.length; i++) {
  const segment = segments[i];
  const { speaker, start_time, end_time, text, id } = segment;
  
  // Znajdź płeć mówcy
  const speakerMeta = speakers.find(s => s.id === speaker || s.name === speaker);
  const gender = speakerMeta?.gender || 'unknown';
  
  const outputFilename = `${String(i + 1).padStart(3, '0')}_${speaker}_${id}.mp3`;
  const outputPath = path.join(exportDir, outputFilename);
  
  console.log(`[${i + 1}/${segments.length}] Wycinam: ${speaker} (${start_time}s -> ${end_time}s)`);
  
  try {
    // FFmpeg: -ss (start), -to (koniec), -c copy (bez rekompresji dla szybkości)
    // Używamy precyzyjnego pozycjonowania przed wejściem (-ss przed -i dla szybkości, ale po -i dla precyzji)
    // Dla małych plików -i przed -ss jest bezpieczniejsze dla precyzji.
    const ffmpegCmd = `ffmpeg -y -i "${audioPath}" -ss ${start_time} -to ${end_time} -c copy "${outputPath}" -loglevel error`;
    execSync(ffmpegCmd);
    
    manifest.segments.push({
      index: i + 1,
      filename: outputFilename,
      speaker,
      gender,
      start_time,
      end_time,
      duration: (end_time - start_time).toFixed(3),
      text
    });
  } catch (error) {
    console.error(`  ❌ Błąd przy segmencie ${i + 1}:`, error.message);
  }
}

// 4. Zapisz manifest
const manifestPath = path.join(exportDir, 'manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`\n✅ GOTOWE! Wyeksportowano ${manifest.segments.length} segmentów.`);
console.log(`📄 Manifest zapisany w: ${path.join(exportDirName, 'manifest.json')}\n`);
