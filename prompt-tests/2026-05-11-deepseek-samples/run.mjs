#!/usr/bin/env node
// Two fresh sample podcasts using the new default model (deepseek/deepseek-v4-flash)
// through the patched prod endpoint.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENDPOINT = 'http://localhost:3300/api/generate-podcast';
const MODEL = 'deepseek/deepseek-v4-flash';

const SAMPLES = [
  {
    slug: 'sample-1-claude-4-7',
    title: 'Anthropic Just Dropped Claude 4.7 And Exposed A Secret Super Model',
    content: fs.readFileSync(path.resolve(__dirname, '..', '2026-04-18', 'content.md'), 'utf8'),
  },
  {
    slug: 'sample-2-prad-i-ai',
    title: 'Centra danych AI pożerają prąd — Polska podnosi ceny',
    content: `Rosnące zapotrzebowanie centrów danych obsługujących sztuczną inteligencję powoduje, że największe firmy technologiczne podpisują kontrakty na dostawy energii na dziesiątki lat naprzód.

W Stanach Zjednoczonych pojedyncze centra danych zużywają już tyle prądu co małe miasta. Microsoft, Google i Amazon ścigają się o lokalizacje przy elektrowniach jądrowych, a Meta zapowiedziała budowę własnej elektrowni przy kampusie.

W Polsce ceny energii dla gospodarstw domowych mają w przyszłym roku wzrosnąć o około osiem procent. Rząd tłumaczy podwyżki kosztami modernizacji sieci i zielonej transformacji, ale eksperci ostrzegają, że globalna konkurencja o prąd ze strony AI pociąga ceny w górę nawet bez lokalnych podwyżek.

Część polskich firm rozważa przenoszenie serwerowni za granicę, gdzie energia jest tańsza i bardziej stabilna. Małe firmy IT obawiają się, że nie wytrzymają rachunków za prąd, a zwykli ludzie pytają, dlaczego mają płacić więcej, żeby Dolina Krzemowa mogła karmić swoje modele.`,
  },
];

function envelopes(text) {
  const out = []; let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start !== -1) { out.push(text.slice(start, i + 1)); start = -1; } }
  }
  return out;
}

async function generate({ slug, title, content }) {
  const t0 = Date.now();
  console.log(`Generating ${slug}...`);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      raw_text: content,
      title,
      language: 'pl',
      model: MODEL,
      tts: { provider: 'omnivoice' },
    }),
    signal: AbortSignal.timeout(360_000),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  if (!res.ok) return { slug, title, ok: false, error: `http ${res.status}: ${text.slice(0,400)}`, ms };
  const envs = envelopes(text);
  if (!envs.length) return { slug, title, ok: false, error: 'no envelope', ms };
  const final = JSON.parse(envs[envs.length - 1]);
  const conv = final?.data?.conversation;
  if (!Array.isArray(conv)) return { slug, title, ok: false, error: 'no conversation', ms };
  return { slug, title, ok: true, ms, conversation: conv };
}

const results = [];
for (const s of SAMPLES) {
  const r = await generate(s);
  results.push(r);
  if (r.ok) {
    const total = r.conversation.reduce((a, c) => a + c.text.length, 0);
    const lens = r.conversation.map(c => c.text.length);
    console.log(`  OK ${r.ms}ms — ${r.conversation.length} lines, ${total} chars, per-line ${Math.min(...lens)}-${Math.max(...lens)}`);
    fs.writeFileSync(path.join(__dirname, r.slug + '.json'), JSON.stringify({ title: r.title, conversation: r.conversation }, null, 2));
    const md = `# ${r.title}

**Model:** \`${MODEL}\`
**Latency:** ${r.ms} ms
**Lines:** ${r.conversation.length}  **Total chars:** ${total}  **Per-line:** ${Math.min(...lens)}-${Math.max(...lens)}

---

` + r.conversation.map((c, i) => `${i + 1}. **[${c.speaker}]** ${c.text}`).join('\n\n');
    fs.writeFileSync(path.join(__dirname, r.slug + '.md'), md);
  } else {
    console.log(`  ERR ${r.ms}ms — ${r.error}`);
    fs.writeFileSync(path.join(__dirname, r.slug + '.error.json'), JSON.stringify(r, null, 2));
  }
}
