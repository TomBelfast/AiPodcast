/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readSamples() {
  const filePath = path.join(
    process.cwd(),
    'scripts',
    'fixtures',
    'podcast-film-gemini-caption-samples.json'
  );
  return JSON.parse(fs.readFileSync(filePath, 'utf8')).samples;
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
  };
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
  const headers = buildAuthHeaders();
  const jobsUrl = `${appUrl}/api/podcast-video/podcast-film/jobs`;
  const runLabel = String(process.env.RUN_LABEL || 'batch').trim();
  const pollTimeoutMs = Number(process.env.POLL_TIMEOUT_MS || String(30 * 60 * 1000));
  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || '5000');
  const samples = readSamples();
  const results = [];

  for (const sample of samples) {
    const payload = {
      title: `${sample.title} [${runLabel}]`,
      language: 'pl',
      conversation: sample.conversation,
      tts: {
        provider: 'gemini',
        voice1: process.env.VOICE1 || 'Charon',
        voice2: process.env.VOICE2 || 'Kore',
      },
      avatar: {
        provider: 'soulx',
      },
      captions: 'burn',
      caption_style: 'classic',
      soulx_model: process.env.SOULX_MODEL || 'pro',
      use_face_crop: true,
    };

    const kickoff = await requestJson('POST', jobsUrl, payload, headers);
    if (kickoff.statusCode !== 202) {
      throw new Error(
        `Kickoff failed for sample ${sample.id}: ${kickoff.statusCode} ${JSON.stringify(kickoff.json)}`
      );
    }

    const jobId = String(kickoff.json.job_id || '').trim();
    const statusUrl =
      typeof kickoff.json.status_url === 'string'
        ? kickoff.json.status_url
        : `${jobsUrl}/${jobId}/status`;
    const finalStatus = await pollStatus(statusUrl, headers, pollTimeoutMs, pollIntervalMs);
    const donePayload = getDonePayload(finalStatus);

    if (String(finalStatus.state || '') !== 'done' || donePayload.success !== true) {
      throw new Error(
        `Sample ${sample.id} failed: ${JSON.stringify(finalStatus.error || finalStatus)}`
      );
    }

    results.push({
      sample_id: sample.id,
      title: payload.title,
      job_id: jobId,
      status_url: statusUrl,
      caption_timing_mode: donePayload.captionTimingMode,
      caption_alignment_mode: donePayload.captionAlignmentMode,
      mp4_url: donePayload.mp4Url,
      srt_url: donePayload.srtUrl,
    });
  }

  console.log(
    JSON.stringify(
      {
        run_label: runLabel,
        sample_count: results.length,
        results,
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
