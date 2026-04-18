/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function readApiKey() {
  if (process.env.PODCAST_API_KEY) return process.env.PODCAST_API_KEY;
  if (process.env.APP_API_KEY) return process.env.APP_API_KEY;

  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return '';

  const raw = fs.readFileSync(envPath, 'utf8');
  const match = raw.match(/^APP_API_KEY=(.*)$/m);
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

function postJson(routePath, payload, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: 3300,
        path: routePath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'x-api-key': apiKey,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ statusCode: res.statusCode || 0, json: JSON.parse(text) });
          } catch {
            reject(new Error(`Invalid JSON response: ${text}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const apiKey = readApiKey();
  if (!apiKey) {
    throw new Error('Missing PODCAST_API_KEY or APP_API_KEY.');
  }

  const transcript =
    process.env.TEST_TRANSCRIPT ||
    'To jest surowy tekst testowy o sztucznej inteligencji w biznesie. Chce sprawdzic, czy workflow B najpierw zrobi podcast z podzialem na role, a dopiero potem segmenty.';
  const title = process.env.TEST_TITLE || 'Raw Text Dry Run Smoke';
  const minSegments = Number(process.env.MIN_SEGMENTS || '2');
  const dryRun = process.env.DRY_RUN !== 'false';
  const captions = process.env.CAPTIONS || 'burn';

  const response = await postJson(
    '/api/podcast-video/podcast-film/jobs',
    {
      title,
      language: 'pl',
      transcript,
      voice1: 'host_a',
      voice2: 'host_b',
      tts_engine: 'omnivoice',
      dryRun,
      captions,
    },
    apiKey
  );

  if (response.statusCode !== 200) {
    throw new Error(`Expected 200, got ${response.statusCode}: ${JSON.stringify(response.json)}`);
  }

  if (typeof response.json.segments_count !== 'number' || response.json.segments_count < minSegments) {
    throw new Error(`Expected at least 2 generated segments, got ${JSON.stringify(response.json)}`);
  }

  if (!dryRun && typeof response.json.mp4_url !== 'string') {
    throw new Error(`Expected mp4_url in full run response, got ${JSON.stringify(response.json)}`);
  }

  console.log(
    JSON.stringify(
      {
        pipeline: response.json.pipeline,
        dry_run: dryRun,
        segments_count: response.json.segments_count,
        soulx_model: response.json.soulx_model,
        mp4_url: response.json.mp4_url,
        srt_url: response.json.srt_url,
        timings: response.json.timings,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
