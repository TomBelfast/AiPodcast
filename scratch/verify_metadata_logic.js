const fs = require('fs').promises;
const { spawn } = require('child_process');
const path = require('path');

function sanitizeMp4MetadataValue(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, 32000);
}

async function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr}`));
    });
  });
}

async function writeSafeMp4GenerationMetadata(mp4Path, metadata) {
  const entries = Object.entries(metadata)
    .map(([key, value]) => [key, sanitizeMp4MetadataValue(value)])
    .filter((entry) => entry[1] !== null);

  if (entries.length === 0) return { elapsed_ms: 0, metadata_count: 0 };

  const startedAt = Date.now();
  const tmpPath = mp4Path.replace(/\.mp4$/i, '') + '.metadata.mp4';
  const metadataArgs = entries.flatMap(([key, value]) => ['-metadata', `${key}=${value}`]);

  try {
    await runFfmpeg([
      '-y', '-i', mp4Path, '-map', '0', '-c', 'copy',
      '-movflags', '+faststart+use_metadata_tags',
      ...metadataArgs, tmpPath
    ]);
    await fs.rename(tmpPath, mp4Path);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => {});
    throw error;
  }
  return { elapsed_ms: Date.now() - startedAt, metadata_count: entries.length };
}

async function test() {
  const testMp4 = 'scratch/test.mp4';
  const transcript = `[Antoni]: Witaj Zofia!
[Zofia]: Hej Antoni, co tam u Ciebie?
[Antoni]: A wiesz, pracuję nad nowym systemem metadanych dla naszych podcastów.
[Zofia]: O, to brzmi interesująco! Czy będzie tam też transkrypcja?`;

  console.log('Creating dummy MP4...');
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=1', testMp4]);

  console.log('Writing metadata...');
  const result = await writeSafeMp4GenerationMetadata(testMp4, {
    title: 'Test Title',
    description: transcript,
    ai_transcript: transcript,
    comment: 'ai_pipeline=test'
  });
  console.log('Metadata written:', result);

  console.log('Verifying with ffprobe...');
  const probe = spawn('ffprobe', ['-v', 'quiet', '-show_entries', 'format_tags', '-of', 'json', testMp4]);
  let stdout = '';
  probe.stdout.on('data', (c) => (stdout += c.toString()));
  await new Promise((resolve) => probe.on('close', resolve));

  const tags = JSON.parse(stdout).format.tags;
  console.log('Embedded tags:', JSON.stringify(tags, null, 2));

  if (tags.description.includes('[Antoni]: Witaj Zofia!')) {
    console.log('SUCCESS: Transcript embedded correctly!');
  } else {
    console.log('Transcript mismatch.');
  }
}

test().catch(console.error);
