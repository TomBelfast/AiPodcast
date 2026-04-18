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

function postJson(path, payload, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: 3300,
        path,
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

  const response = await postJson(
    '/api/podcast-video/podcast-film/jobs',
    {
      title: 'Hard Cut Smoke',
      language: 'pl',
      transcript: '[Speaker_1]: test.\n[Speaker_2]: test.',
      voice1: 'host_a',
      voice2: 'host_b',
      tts_engine: 'omnivoice',
      captions: 'off',
      wait_for_completion: true,
      return_type: 'json',
    },
    apiKey
  );

  if (response.statusCode !== 200) {
    throw new Error(`Expected 200, got ${response.statusCode}: ${JSON.stringify(response.json)}`);
  }
  if (response.json.transition !== 'none') {
    throw new Error(`Expected transition=none, got ${response.json.transition}`);
  }
  if (response.json.timings?.concat_mode === 'xfade') {
    throw new Error(`Expected hard cut concat mode, got ${response.json.timings.concat_mode}`);
  }

  console.log(JSON.stringify({
    transition: response.json.transition,
    transition_duration: response.json.transition_duration,
    concat_mode: response.json.timings?.concat_mode,
    final_duration_seconds: response.json.final_duration_seconds,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
