/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const EXPECTED_FIRST_FRAME_STYLE = {
  titleSize: 43,
  titleMarginX: 18,
  titleOffsetY: 0,
  titleColor: '#25FF00',
  titleOutlineColor: '#050608',
};

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
        host: process.env.APP_HOST || '127.0.0.1',
        port: Number(process.env.APP_PORT || '3300'),
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

function assertSameStyle(actual) {
  for (const [key, expectedValue] of Object.entries(EXPECTED_FIRST_FRAME_STYLE)) {
    if (!actual || actual[key] !== expectedValue) {
      throw new Error(
        `Expected default first_frame_style.${key}=${expectedValue}, got ${JSON.stringify(actual)}`
      );
    }
  }
}

async function main() {
  const apiKey = readApiKey();
  if (!apiKey) {
    throw new Error('Missing PODCAST_API_KEY or APP_API_KEY.');
  }

  const response = await postJson(
    '/api/podcast-video/podcast-film/jobs',
    {
      title: 'Sztuczna inteligencja w marketingu',
      language: 'pl',
      dry_run: true,
      captions: 'burn',
      caption_style: 'highlight',
      tts: {
        provider: 'gemini',
      },
      conversation: [
        {
          speaker: 'speaker1',
          text: 'Sztuczna inteligencja zmienia marketing szybciej niz poprzednie narzedzia.',
        },
        {
          speaker: 'speaker2',
          text: 'Dlatego warto miec spójny preset tytulow i napisow w kazdym renderze.',
        },
      ],
    },
    apiKey
  );

  if (response.statusCode !== 200) {
    throw new Error(`Expected 200, got ${response.statusCode}: ${JSON.stringify(response.json)}`);
  }

  assertSameStyle(response.json.first_frame_style);

  console.log(
    JSON.stringify(
      {
        pipeline: response.json.pipeline,
        dry_run: response.json.dry_run,
        first_frame_style: response.json.first_frame_style,
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
