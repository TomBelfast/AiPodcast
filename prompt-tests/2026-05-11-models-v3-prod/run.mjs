#!/usr/bin/env node
// Hits the LIVE /api/generate-podcast endpoint on localhost:3300 (Next dev server).
// Verifies the patched prompt (v2) actually runs through the prod pipeline end-to-end.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const ENDPOINT = process.env.ENDPOINT || 'http://localhost:3300/api/generate-podcast';

const MODELS = [
  'google/gemini-3-flash-preview',
  'google/gemini-3.1-flash-lite',
  'deepseek/deepseek-v4-flash',
];

const rawText = fs.readFileSync(path.join(ROOT, 'prompt-tests', '2026-04-18', 'content.md'), 'utf8');
const title = 'Anthropic Just Dropped Claude 4.7 And Exposed A Secret Super Model';

function slug(m) { return m.split('/')[1].replace(/[^a-z0-9.-]/gi, '-'); }

async function callEndpoint(model) {
  const t0 = Date.now();
  let res, text;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw_text: rawText,
        title,
        language: 'pl',
        model,
        tts: { provider: 'omnivoice' },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    text = await res.text();
  } catch (e) {
    return { model, ok: false, error: `fetch: ${e.message}`, ms: Date.now() - t0 };
  }
  const ms = Date.now() - t0;
  if (!res.ok) return { model, ok: false, error: `http ${res.status}: ${text.slice(0, 600)}`, ms };
  // Endpoint streams concatenated JSON envelopes: {"type":"partial",...}{"type":"complete",...}
  // Extract the LAST envelope and use its `data.conversation`.
  const envelopes = [];
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start !== -1) { envelopes.push(text.slice(start, i + 1)); start = -1; } }
  }
  if (!envelopes.length) return { model, ok: false, error: `no JSON envelope found in response (${text.length} chars)`, ms };
  let parsed;
  try { parsed = JSON.parse(envelopes[envelopes.length - 1]); }
  catch (e) { return { model, ok: false, error: `parse final envelope: ${e.message}`, ms }; }
  const conv = parsed?.data?.conversation || parsed?.conversation || null;
  if (!Array.isArray(conv)) return { model, ok: false, error: `no conversation array (envelope type=${parsed?.type})`, ms };
  return { model, ok: true, ms, conversation: conv, envelopeType: parsed.type };
}

function renderMd(r) {
  const head = `# ${slug(r.model)} (prod endpoint)

**Model:** \`${r.model}\`
**Endpoint:** \`${ENDPOINT}\`
**Latency:** ${r.ms} ms
**Prompt source:** \`src/app/api/generate-podcast/route.ts\` (po patchu v2)
**Content:** \`prompt-tests/2026-04-18/content.md\`

---

`;
  if (!r.ok) return head + `## ERROR\n\n\`\`\`\n${r.error}\n\`\`\`\n`;
  const lines = r.conversation.map((c, i) => `${i + 1}. **[${c.speaker}]** ${c.text}`).join('\n\n');
  const total = r.conversation.reduce((s, c) => s + c.text.length, 0);
  const lens = r.conversation.map(c => c.text.length);
  const inRange = lens.filter(L => L >= 150 && L <= 220).length;
  return head + lines + `\n\n---\n\n## Stats\n- Linie: ${r.conversation.length}\n- Łącznie: ${total} znaków\n- Per-line zakres: ${Math.min(...lens)}-${Math.max(...lens)} (in-range 150-220: ${inRange}/${lens.length})\n`;
}

// Probe endpoint first
console.log(`Probing ${ENDPOINT}...`);
try {
  const probe = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) });
  console.log(`Probe: HTTP ${probe.status} (expected 400 for empty body)`);
} catch (e) {
  console.error(`Endpoint unreachable: ${e.message}`);
  process.exit(2);
}

console.log(`Calling ${MODELS.length} models sequentially (avoid dev-server pile-up)...`);
const results = [];
for (const m of MODELS) {
  const r = await callEndpoint(m);
  results.push(r);
  console.log(`${r.ok ? 'OK ' : 'ERR'}  ${m}  ${r.ms}ms${r.ok ? '' : '  ' + r.error.slice(0, 120)}`);
}

for (const r of results) {
  const base = path.join(__dirname, slug(r.model));
  if (r.ok) fs.writeFileSync(base + '.json', JSON.stringify({ conversation: r.conversation }, null, 2));
  else fs.writeFileSync(base + '.error.json', JSON.stringify(r, null, 2));
  fs.writeFileSync(base + '.md', renderMd(r));
}

const summary = `# Prod-endpoint shootout — 2026-05-11 v2-prod

## Setup
- **Endpoint:** \`${ENDPOINT}\` (Next dev server, hot-reloaded source)
- **Prompt:** z \`src/app/api/generate-podcast/route.ts\` po patchu v2 (1700-2100 zn, 10 wymian, 150-220 zn/linia, bez \`siekiery\`)
- **TTS provider:** omnivoice (uruchamia plain-speech guard, jak w v2 standalone)
- **Cel:** potwierdzenie że patch faktycznie żyje w prod-pipeline i daje takie same wyniki co standalone

## Wyniki

| Model | Status | Latency | Linie | Znaków | per-line in 150-220 |
|---|---|---:|---:|---:|---:|
${results.map(r => {
  if (!r.ok) return `| \`${r.model}\` | ERROR | ${r.ms} ms | - | - | - |`;
  const lens = r.conversation.map(c => c.text.length);
  const total = lens.reduce((a,b)=>a+b,0);
  const ok = lens.filter(L => L>=150 && L<=220).length;
  return `| \`${r.model}\` | OK | ${r.ms} ms | ${r.conversation.length} | ${total} | ${ok}/${lens.length} |`;
}).join('\n')}
`;
fs.writeFileSync(path.join(__dirname, '_summary.md'), summary);
console.log('\nWrote _summary.md');
