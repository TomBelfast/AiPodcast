/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function readEnvLocalValue(name) {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return '';

  const raw = fs.readFileSync(envPath, 'utf8');
  const match = raw.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

function readEnvValue(names) {
  for (const name of names) {
    const runtimeValue = process.env[name];
    if (runtimeValue && runtimeValue.trim()) {
      return runtimeValue.trim();
    }
  }

  for (const name of names) {
    const fileValue = readEnvLocalValue(name);
    if (fileValue) {
      return fileValue;
    }
  }

  return '';
}

function readBearerToken() {
  return readEnvValue(['AUTH_BEARER_TOKEN', 'BEARER_TOKEN']);
}

function readGeminiApiKey() {
  return readEnvValue(['SMOKE_GEMINI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']);
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function requestJson(method, urlString, payload, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : http;
    const body = payload === undefined ? null : JSON.stringify(payload);

    const req = transport.request(
      {
        protocol: url.protocol,
        host: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          Accept: 'application/json',
          ...headers,
          ...(body
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({
              statusCode: res.statusCode || 0,
              json: text ? JSON.parse(text) : {},
            });
          } catch {
            reject(new Error(`Invalid JSON response from ${urlString}: ${text}`));
          }
        });
      }
    );

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function buildAuthHeaders() {
  const bearerToken = readBearerToken();
  return bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {};
}

function decodeWavDataUrl(audioDataUrl) {
  const prefix = 'data:audio/wav;base64,';
  if (typeof audioDataUrl !== 'string' || !audioDataUrl.startsWith(prefix)) {
    throw new Error(`Expected data:audio/wav;base64,... response, got ${String(audioDataUrl).slice(0, 32)}`);
  }

  return Buffer.from(audioDataUrl.slice(prefix.length), 'base64');
}

function probeWavWithFfprobe(filePath) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', filePath],
    { encoding: 'utf8' }
  );

  if (result.status !== 0) {
    throw new Error(`ffprobe failed for ${filePath}: ${result.stderr || result.stdout || 'unknown error'}`);
  }

  const parsed = JSON.parse(result.stdout || '{}');
  const format = parsed && parsed.format ? parsed.format : {};

  return {
    durationSec: Number(format.duration || 0),
    sizeBytes: Number(format.size || 0),
  };
}

async function main() {
  const appUrl = (process.env.APP_URL || 'http://127.0.0.1:3300').replace(/\/+$/, '');
  const dryRun = parseBoolean(process.env.DRY_RUN, false);
  const saveOutput = parseBoolean(process.env.SAVE_OUTPUT, false);
  const sendGeminiApiKey = parseBoolean(process.env.SEND_GEMINI_API_KEY, true);
  const voice1 = String(process.env.VOICE1 || 'Charon').trim();
  const voice2 = String(process.env.VOICE2 || 'Kore').trim();
  const headers = buildAuthHeaders();

  const voicesResponse = await requestJson('GET', `${appUrl}/api/voices?provider=gemini`, undefined, headers);
  if (voicesResponse.statusCode !== 200) {
    throw new Error(
      `Gemini voices request expected 200, got ${voicesResponse.statusCode}: ${JSON.stringify(voicesResponse.json)}`
    );
  }

  const voices = Array.isArray(voicesResponse.json?.voices) ? voicesResponse.json.voices : [];
  if (!voices.length) {
    throw new Error('Gemini voices response was empty.');
  }

  const availableVoiceIds = new Set(voices.map((voice) => voice && voice.id).filter(Boolean));
  if (!availableVoiceIds.has(voice1) || !availableVoiceIds.has(voice2)) {
    throw new Error(
      `Selected voices must exist in /api/voices?provider=gemini. Missing: ${[
        !availableVoiceIds.has(voice1) ? voice1 : '',
        !availableVoiceIds.has(voice2) ? voice2 : '',
      ]
        .filter(Boolean)
        .join(', ')}`
    );
  }

  const payload = {
    ...(dryRun ? { dryRun: true } : {}),
    conversation: [
      {
        speaker: 'Antoni',
        text:
          process.env.TEST_TEXT_1 ||
          'Jo ci godom, to jest krotki live smoke dla Gemini TTS w glownej sciezce.',
      },
      {
        speaker: 'Zofia',
        text:
          process.env.TEST_TEXT_2 ||
          'Hej, sprawdzamy prawdziwe audio i format wav, nie tylko suchy dry run.',
      },
    ],
    tts: {
      provider: 'gemini',
      voice1,
      voice2,
    },
  };

  if (sendGeminiApiKey) {
    const geminiApiKey = readGeminiApiKey();
    if (!geminiApiKey && !dryRun) {
      throw new Error(
        'SEND_GEMINI_API_KEY=true, but no SMOKE_GEMINI_API_KEY/GEMINI_API_KEY/GOOGLE_API_KEY found.'
      );
    }

    if (geminiApiKey) {
      payload.geminiApiKey = geminiApiKey;
      payload.tts.apiKey = geminiApiKey;
    }
  }

  const ttsResponse = await requestJson('POST', `${appUrl}/api/text-to-speech`, payload, headers);
  if (ttsResponse.statusCode !== 200) {
    throw new Error(
      `Gemini TTS request expected 200, got ${ttsResponse.statusCode}: ${JSON.stringify(ttsResponse.json)}`
    );
  }

  const body = ttsResponse.json || {};
  const summary = {
    appUrl,
    dryRun,
    provider: body.provider,
    model: body.model,
    mimeType: body.mimeType,
    processingTimeMs: body.processingTimeMs,
    voicesCount: voices.length,
    selectedVoices: [voice1, voice2],
    usedExplicitGeminiApiKey: sendGeminiApiKey && Boolean(payload.geminiApiKey),
  };

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          ...summary,
          debug: body.debug,
        },
        null,
        2
      )
    );
    return;
  }

  const wavBuffer = decodeWavDataUrl(body.audioBase64);
  const outputPath =
    process.env.OUT_FILE ||
    (saveOutput
      ? path.join(process.cwd(), 'test-output', `gemini-tts-smoke-${Date.now()}.wav`)
      : path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-tts-smoke-')), 'out.wav'));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, wavBuffer);

  const ffprobeSummary = probeWavWithFfprobe(outputPath);

  console.log(
    JSON.stringify(
      {
        ...summary,
        audioBytes: wavBuffer.length,
        ffprobeDurationSec: ffprobeSummary.durationSec,
        ffprobeSizeBytes: ffprobeSummary.sizeBytes,
        outputPath,
        audioBase64Prefix: String(body.audioBase64 || '').slice(0, 32),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
