/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

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

function readApiKey() {
  return readEnvValue(['PODCAST_API_KEY', 'APP_API_KEY']);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
  if (bearerToken) {
    return { Authorization: `Bearer ${bearerToken}` };
  }

  const apiKey = readApiKey();
  if (!apiKey) {
    throw new Error('Missing AUTH_BEARER_TOKEN/BEARER_TOKEN or PODCAST_API_KEY/APP_API_KEY.');
  }

  return { 'x-api-key': apiKey };
}

function getDonePayload(statusJson) {
  const result = isPlainObject(statusJson.result) ? statusJson.result : null;

  return {
    success:
      typeof statusJson.success === 'boolean'
        ? statusJson.success
        : typeof result?.success === 'boolean'
          ? result.success
          : null,
    mp4Url:
      typeof statusJson.mp4_url === 'string'
        ? statusJson.mp4_url
        : typeof result?.mp4_url === 'string'
          ? result.mp4_url
          : null,
    srtUrl:
      typeof statusJson.srt_url === 'string'
        ? statusJson.srt_url
        : typeof result?.srt_url === 'string'
          ? result.srt_url
          : null,
    ttsEngine:
      typeof statusJson.tts_engine === 'string'
        ? statusJson.tts_engine
        : typeof result?.tts_engine === 'string'
          ? result.tts_engine
          : null,
    captionTimingMode:
      typeof statusJson.caption_timing_mode === 'string'
        ? statusJson.caption_timing_mode
        : typeof result?.caption_timing_mode === 'string'
          ? result.caption_timing_mode
          : null,
    captionAlignmentMode:
      typeof statusJson.caption_alignment_mode === 'string'
        ? statusJson.caption_alignment_mode
        : typeof result?.caption_alignment_mode === 'string'
          ? result.caption_alignment_mode
          : null,
    timings: isPlainObject(statusJson.timings)
      ? statusJson.timings
      : isPlainObject(result?.timings)
        ? result.timings
        : null,
    segmentsCount:
      typeof result?.segments_count === 'number' ? result.segments_count : null,
  };
}

function buildConversationPayload() {
  return [
    {
      speaker: 'Speaker_1',
      text: 'Czesc. To bardzo krotki test Gemini.',
    },
    {
      speaker: 'Speaker_2',
      text: 'Sprawdzamy dwa segmenty i finalny render.',
    },
  ];
}

function buildRawTranscript() {
  return (
    process.env.TEST_TRANSCRIPT ||
    'To jest krotki test surowego tekstu dla podcast-film z Gemini. Chcemy sprawdzic generowanie dialogu, audio i finalnego wideo.'
  );
}

async function pollStatus(statusUrl, headers, timeoutMs, pollIntervalMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await requestJson('GET', statusUrl, undefined, headers);
    if (response.statusCode !== 200) {
      throw new Error(
        `Status poll expected 200, got ${response.statusCode}: ${JSON.stringify(response.json)}`
      );
    }

    const statusJson = response.json;
    const state = String(statusJson.state || '');
    if (state === 'done' || state === 'failed') {
      return statusJson;
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out after ${timeoutMs}ms while polling ${statusUrl}`);
}

async function main() {
  const appUrl = (process.env.APP_URL || 'http://127.0.0.1:3300').replace(/\/+$/, '');
  const jobsUrl = `${appUrl}/api/podcast-video/podcast-film/jobs`;
  const ttsEngine = String(process.env.TTS_ENGINE || 'gemini').trim().toLowerCase();
  const mode = String(process.env.SMOKE_MODE || 'conversation').trim().toLowerCase();
  const dryRun = parseBoolean(process.env.DRY_RUN, false);
  const captions = String(process.env.CAPTIONS || 'off').trim().toLowerCase();
  const pollTimeoutDefaultMs =
    mode === 'raw'
      ? captions === 'burn'
        ? 30 * 60 * 1000
        : 20 * 60 * 1000
      : 5 * 60 * 1000;
  const pollTimeoutMs = Number(process.env.POLL_TIMEOUT_MS || String(pollTimeoutDefaultMs));
  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || '3000');
  const sendGeminiApiKey = parseBoolean(process.env.SEND_GEMINI_API_KEY, false);
  const headers = buildAuthHeaders();

  if (ttsEngine !== 'gemini' && ttsEngine !== 'omnivoice' && ttsEngine !== 'elevenlabs') {
    throw new Error(`Unsupported TTS_ENGINE="${ttsEngine}". Use gemini, elevenlabs, or omnivoice.`);
  }

  if (mode !== 'conversation' && mode !== 'raw') {
    throw new Error(`Unsupported SMOKE_MODE="${mode}". Use conversation or raw.`);
  }

  const payload = {
    title: process.env.TEST_TITLE || 'Podcast Film Gemini Smoke',
    language: process.env.TEST_LANGUAGE || 'pl',
    tts: {
      provider: ttsEngine,
      voice1:
        process.env.VOICE1 ||
        (ttsEngine === 'elevenlabs' ? 'FF7KdobWPaiR0vkcALHF' : 'Charon'),
      voice2:
        process.env.VOICE2 ||
        (ttsEngine === 'elevenlabs' ? 'BpjGufoPiobT79j2vtj4' : 'Kore'),
    },
    avatar: {
      provider: 'soulx',
    },
    captions,
    soulx_model: process.env.SOULX_MODEL || 'pro',
    use_face_crop: parseBoolean(process.env.USE_FACE_CROP, true),
    ...(dryRun ? { dryRun: true } : {}),
    ...(mode === 'conversation'
      ? { conversation: buildConversationPayload() }
      : { raw_text: buildRawTranscript() }),
  };

  if (sendGeminiApiKey && ttsEngine === 'gemini') {
    const geminiApiKey = readGeminiApiKey();
    if (!geminiApiKey) {
      throw new Error(
        'SEND_GEMINI_API_KEY=true, but no SMOKE_GEMINI_API_KEY/GEMINI_API_KEY/GOOGLE_API_KEY found.'
      );
    }
    payload.gemini_api_key = geminiApiKey;
    payload.tts.apiKey = geminiApiKey;
  }

  const kickoff = await requestJson('POST', jobsUrl, payload, headers);

  if (dryRun) {
    if (kickoff.statusCode !== 200) {
      throw new Error(`Expected 200 for dryRun, got ${kickoff.statusCode}: ${JSON.stringify(kickoff.json)}`);
    }
    if (kickoff.json.success !== true) {
      throw new Error(`DryRun did not return success=true: ${JSON.stringify(kickoff.json)}`);
    }

    console.log(
      JSON.stringify(
        {
          mode,
          dry_run: true,
          tts_engine: kickoff.json.tts_engine,
          segments_count: kickoff.json.segments_count,
          voice1: kickoff.json.voice1,
          voice2: kickoff.json.voice2,
          voices_swapped_for_gender: kickoff.json.voices_swapped_for_gender,
        },
        null,
        2
      )
    );
    return;
  }

  if (kickoff.statusCode !== 202) {
    throw new Error(`Expected 202 for async job, got ${kickoff.statusCode}: ${JSON.stringify(kickoff.json)}`);
  }

  const jobId = String(kickoff.json.job_id || '').trim();
  if (!jobId) {
    throw new Error(`Missing job_id in kickoff response: ${JSON.stringify(kickoff.json)}`);
  }

  const statusUrl =
    process.env.USE_RETURNED_STATUS_URL === 'true' && typeof kickoff.json.status_url === 'string'
      ? kickoff.json.status_url
      : `${appUrl}/api/podcast-video/podcast-film/jobs/${jobId}/status`;

  const finalStatus = await pollStatus(statusUrl, headers, pollTimeoutMs, pollIntervalMs);
  const donePayload = getDonePayload(finalStatus);

  if (String(finalStatus.state || '') !== 'done') {
    const detail =
      finalStatus.detail ||
      finalStatus.error?.detail ||
      'Podcast-film job finished without done state.';
    throw new Error(`Job ${jobId} did not finish successfully: ${detail}`);
  }

  if (donePayload.success !== true) {
    throw new Error(`Expected success=true in final status: ${JSON.stringify(finalStatus)}`);
  }

  if (donePayload.ttsEngine !== ttsEngine) {
    throw new Error(
      `Expected top-level tts_engine="${ttsEngine}", got ${JSON.stringify(donePayload.ttsEngine)}`
    );
  }

  if (typeof donePayload.mp4Url !== 'string' || !donePayload.mp4Url) {
    throw new Error(`Missing mp4_url in final status: ${JSON.stringify(finalStatus)}`);
  }

  const expectedCaptionTimingMode = String(
    process.env.EXPECT_CAPTION_TIMING_MODE ||
      (captions === 'burn'
        ? ttsEngine === 'gemini' || ttsEngine === 'omnivoice'
          ? 'whisper'
          : 'estimated'
        : 'disabled')
  ).trim();
  if (expectedCaptionTimingMode && donePayload.captionTimingMode !== expectedCaptionTimingMode) {
    throw new Error(
      `Expected caption_timing_mode=${JSON.stringify(expectedCaptionTimingMode)}, got ${JSON.stringify(donePayload.captionTimingMode)}`
    );
  }

  const expectedAlignmentMode = String(
    process.env.EXPECT_CAPTION_ALIGNMENT_MODE ||
      (captions === 'burn'
        ? ttsEngine === 'gemini' || ttsEngine === 'omnivoice'
          ? 'whisper_reconciled'
          : ''
        : 'disabled')
  ).trim();
  if (expectedAlignmentMode && donePayload.captionAlignmentMode !== expectedAlignmentMode) {
    throw new Error(
      `Expected caption_alignment_mode=${JSON.stringify(expectedAlignmentMode)}, got ${JSON.stringify(donePayload.captionAlignmentMode)}`
    );
  }

  console.log(
    JSON.stringify(
      {
        mode,
        dry_run: false,
        job_id: jobId,
        status_url: statusUrl,
        state: finalStatus.state,
        success: donePayload.success,
        tts_engine: donePayload.ttsEngine,
        caption_timing_mode: donePayload.captionTimingMode,
        caption_alignment_mode: donePayload.captionAlignmentMode,
        segments_count: donePayload.segmentsCount,
        mp4_url: donePayload.mp4Url,
        srt_url: donePayload.srtUrl,
        timings: donePayload.timings,
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
