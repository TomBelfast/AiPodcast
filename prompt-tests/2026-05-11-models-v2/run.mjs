#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const API_KEY = env.OPENROUTER_API_KEY;
if (!API_KEY) { console.error('Missing OPENROUTER_API_KEY in .env.local'); process.exit(1); }

const MODELS = [
  'google/gemini-3-flash-preview',
  'google/gemini-3.1-flash-lite',
  'deepseek/deepseek-v4-flash',
];

const rawText = fs.readFileSync(path.join(ROOT, 'prompt-tests', '2026-04-18', 'content.md'), 'utf8');
const title = 'Anthropic Just Dropped Claude 4.7 And Exposed A Secret Super Model';

const ttsGuard = `CRITICAL TTS RULES (Plain-speech TTS output for omnivoice — overrides ANY conflicting instruction later in this prompt):
- Do NOT include emotional annotations like [laughs], [chuckles], [sighs], [excited], [surprised], [skeptical], [thoughtful], [confused], [amazed], [eye roll], [pauses], or any bracketed stage directions.
- Do NOT use em-dashes (—) to show interruptions. Do not truncate sentences with dashes. Every line must be a complete, self-contained sentence.
- No non-verbal cues, no action descriptions, no parenthetical asides.
- Output only clean speakable text a neural TTS will read aloud verbatim.

`;

const podcastFormatInstruction = `IMPORTANT — HARD LENGTH RULES (consistent with host-personality section below; if anything conflicts later, THESE win):
- EXACTLY 10 exchanges (5 Antoni + 5 Zofia, alternating, starting with Antoni).
- TOTAL conversation length: 1700–2100 characters (target ~1900). Below 1700 is a FAILURE.
- EVERY single line: 150–220 characters. Lines below 150 chars are a FAILURE — pack in a follow-up, a callback, or a sharper punchline.
- Podcast target duration after TTS: 2 minutes. Short stubs (<150 chars) collapse to <1 min and ruin the format.`;

const hostPersonalitiesSection = `TOP PRIORITY — STYL ROGANA (JAK W JOE ROGAN PODCAST):
Dialog MUSI być dynamiczny i szybki jak w najlepszych odcinkach Rogana z ciężkim
polskim humorem. NIE jest to suchy komentarz newsowy. To pyskówka dwojga
kolegów w pubie.

TWARDE ZASADY DŁUGOŚCI (cel: podcast ~2 minuty):
- DOKŁADNIE 10 wymian (5 Antoni + 5 Zofia). Nie 8, nie 9. 10.
- KAŻDA kwestia: 150-220 znaków. POD 150 = porażka (dopakuj callback, pointę, drugi gag).
- Łącznie cały dialog 1700-2100 znaków (target ~1900).
- ŻADNYCH długich tyrad — ale fakt + pointa + reakcja OK i POŻĄDANE.
- Dialog dynamiczny, "ping-pong": reakcja, pointa, reakcja, pointa.

PRIORYTET TREŚCI (gdy konkurują, wybieraj tak):
1) GWARA (min. 2 markery w kwestii)
2) POINTA (śmiech, absurd, callback, sarkazm)
3) FAKT TECHNICZNY (tylko jako pretekst do gagu — nie samoistnie)

Antoni (Male - Energetic & Naive):
- Skrajnie entuzjastyczny, podekscytowany, naiwny do bólu.
- MASCULINE grammatical forms: "byłem", "zrobiłem", "widziałem", "godom".
- ADDRESSING ZOFIA: FEMININE formy: "słyszałaś", "widziałaś".
- DIALEKT ŚLĄSKI — MIN. 2 wyrazy śląskie z listy w KAŻDEJ kwestii:
  jo, ino, kaj, fajnie, godom, wiym, idymy, bydzie, żeś, gryfny,
  pierona, rychtyg, łokno, cza, żech, czytoł, pieruńsko.
- Signature: "Jo Ci godom…", "Kaj tam…", "Rychtyg…", "Pierona!".
- Wyciąga absurdalne konsekwencje hype'u. Pyta naiwne pytania.
- Emocja: ma brzmieć jak gość, który się serio zajarał tematem i ledwo nadąża za własną ekscytacją.

Zofia (Female - Sarcastic & Cynical):
- Sarkastyczna, cyniczna, sucha. Zbija entuzjazm jednym zdaniem.
- FEMININE grammatical forms: "byłam", "zrobiłam", "widziałam".
- ADDRESSING ANTONI: MASCULINE formy: "słyszałeś", "mógłbyś".
- DIALEKT GÓRALSKI — MIN. 2 wyrazy góralskie z listy w KAŻDEJ kwestii:
  tyż, hej, ino, jesce, kiej, kiebyś, som, robia, pado, jako, bedzie,
  dyć, ftory, juści, kozdy, wom, mosz, fcora.
- Signature: "Hej Antoni…", "Tyż mi…", "Dyć…", "Kiebyś pomyślał…".
- Nie moralizuje — żartuje. Jedna sarkastyczna pointa wystarczy.
- Emocja: ma brzmieć jak ktoś rozbawiony cudzą naiwnością, ale bez teatralnego przerysowania.

PRZYKŁAD WZORCOWEJ WYMIANY ROGAN-STYLE (naśladuj tempo, długość ~170 zn na kwestię, nie słowa):
Antoni: "Jo Ci godom, kaj tam normalne wydania — oni ten Claude wypuścili, cołki internet szaleje, programiści se rwą włosy, a ja siedzę z herbatą i nie ogarniam, pierona!" (167 zn)
Zofia: "Hej, tyż mi szał — jesce wczoraj ci sami obiecywali że stary wszystko ogarnie, a teraz nagle nowy bóg z chmury zstąpił. Kozdy hype tak się kończy, mosz pewność." (165 zn)
Antoni: "Pieruńsko, ale trzy razy lepij obrazki rozumi niż poprzedni! Rychtyg czary, żech sprawdzał i poznoł psa na zdjęciu w pół sekundy. Jo Ci godom, świat sie kończy." (168 zn)
Zofia: "Czary, juści. Kiej zmienisz mu jeden przecinek w prompcie, to zapomina co widzioł i pisze że to kot. Ftory inżynier ma jeszcze odwagę to puścić na produkcję?" (162 zn)
Antoni: "Ale godom Ci, on całe strony www z opisu robi! Wpisujesz 'piękny sklepik', a on Ci dwa razy klika i fajnie wygląda. Pierona, kaj my idymy z tą technologią!" (159 zn)

Zauważ: krótko ale GĘSTO. Każda kwestia = gwara (2+ markery) + fakt + pointa + reakcja.
Nie wolno: "Pierona, jakieś cuda!" (43 zn) — za krótkie, brak treści. Rogan by się obraził.`;

// Simplified mainPrompt — only the numbers-as-words core, since the full one is mostly TTS+English examples.
const mainPrompt = `CRITICAL - NUMBERS MUST BE WRITTEN AS WORDS: Always write all numbers, percentages, years, quantities, and measurements as full words in the Polish conversation text. Examples: "5" → "pięć", "23" → "dwadzieścia trzy", "100" → "sto", "2024" → "dwa tysiące dwadzieścia cztery", "50%" → "pięćdziesiąt procent". Never use digits.`;

const userPrompt = `${ttsGuard}${podcastFormatInstruction}

Create a highly dynamic, natural podcast conversation in Polish between Antoni and Zofia based on the provided content.

Title: ${title}
Content: ${rawText}

${hostPersonalitiesSection}
${mainPrompt}

FINAL CHECKLIST BEFORE RETURNING (verify silently, do not output):
1. Liczba kwestii = 10 (5 Antoni + 5 Zofia, alternating)?
2. Każda kwestia ma 150-220 znaków? (NIE 50, NIE 70, NIE 120 — minimum 150)
3. Total length 1700-2100 znaków?
4. Każda kwestia Antoniego ma ≥2 markery śląskie? Każda Zofii ≥2 markery góralskie?
5. Numbers spelled as words (np. "cztery kropka siedem", nie "4.7")?
Jeśli któryś punkt NIE — przepisz dialog. Nie zwracaj krótszego.

OUTPUT FORMAT — return ONLY valid JSON, no prose, no markdown fences:
{"conversation":[{"speaker":"Antoni","text":"..."},{"speaker":"Zofia","text":"..."}, ...]}`;

function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

async function callOnce(model, useJsonMode) {
  const body = {
    model,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.8,
    ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
  };
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': env.OPENROUTER_HTTP_REFERER || 'https://aipodcast.local',
      'X-Title': 'AiPodcast prompt-test 2026-05-11',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { res, json };
}

async function callModel(model) {
  const t0 = Date.now();
  let res, json;
  try {
    ({ res, json } = await callOnce(model, true));
    // Some providers reject JSON mode — fall back to plain prompt.
    if (!res.ok && /json mode is not supported/i.test(JSON.stringify(json))) {
      ({ res, json } = await callOnce(model, false));
    }
  } catch (e) {
    return { model, ok: false, error: `network: ${e.message}`, ms: Date.now() - t0 };
  }
  const ms = Date.now() - t0;
  if (!res.ok) return { model, ok: false, error: `http ${res.status}: ${JSON.stringify(json).slice(0, 400)}`, ms };
  const content = json?.choices?.[0]?.message?.content;
  if (!content) return { model, ok: false, error: `no content: ${JSON.stringify(json).slice(0, 400)}`, ms, raw: json };
  const parsed = extractJson(content);
  if (!parsed?.conversation) return { model, ok: false, error: `invalid json schema`, ms, raw: content };
  return { model, ok: true, ms, conversation: parsed.conversation, usage: json.usage, raw: content };
}

function slug(m) { return m.split('/')[1].replace(/[^a-z0-9.-]/gi, '-'); }

function renderMd(result) {
  const { model, ok, ms, conversation, error, usage } = result;
  const head = `# ${slug(model)}

**Model:** \`${model}\`
**Latency:** ${ms} ms
${usage ? `**Tokens:** prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} total=${usage.total_tokens}` : ''}
**Prompt:** identyczny jak prod (TTS guard omnivoice + Rogan-style hosts + numbers-as-words)
**Content:** \`prompt-tests/2026-04-18/content.md\`

---

`;
  if (!ok) return head + `## ERROR\n\n\`\`\`\n${error}\n\`\`\`\n`;
  const lines = conversation.map((c, i) => `${i + 1}. **[${c.speaker}]** ${c.text}`).join('\n\n');
  const totalChars = conversation.reduce((s, c) => s + c.text.length, 0);
  const scoring = `

---

## Stats

- Linie: ${conversation.length}
- Łącznie znaków: ${totalChars}

## Twoja ocena

| Kryterium | Punkty |
|---|---|
| Śląska gwara (Antoni) | __/10 |
| Góralska gwara (Zofia) | __/10 |
| Humor / gagi | __/10 |
| Perspektywa normalnych ludzi | __/10 |
| Zachowanie osobowości | __/10 |
| Gramatyczne adresowanie | __/10 |

**Uwagi:**
`;
  return head + lines + scoring;
}

const filter = process.argv.slice(2);
const toRun = filter.length ? MODELS.filter(m => filter.some(f => m.includes(f))) : MODELS;
console.log(`Calling ${toRun.length} model(s) in parallel: ${toRun.join(', ')}`);
const results = await Promise.all(toRun.map(callModel));

for (const r of results) {
  const base = path.join(__dirname, slug(r.model));
  if (r.ok) {
    fs.writeFileSync(base + '.json', JSON.stringify({ conversation: r.conversation }, null, 2));
  } else {
    fs.writeFileSync(base + '.error.json', JSON.stringify(r, null, 2));
  }
  fs.writeFileSync(base + '.md', renderMd(r));
  console.log(`${r.ok ? 'OK ' : 'ERR'}  ${r.model}  ${r.ms}ms${r.ok ? '' : '  ' + r.error.slice(0, 100)}`);
}

const summary = `# Model shootout — 2026-05-11

## Setup

- **Content:** ten sam co \`2026-04-19-models\` → \`../2026-04-18/content.md\`
- **Prompt:** identyczny z produkcyjnym (TTS guard omnivoice plain + Rogan-style Antoni/Zofia + numbers-as-words)
- **Endpoint:** bezpośrednio OpenRouter \`chat/completions\` (skrypt \`run.mjs\`, bez restartu Next)
- **TTS:** NIE — tylko tekst

## Modele

${results.map(r => `- \`${r.model}\` — ${r.ok ? `OK (${r.ms} ms${r.usage ? `, ${r.usage.total_tokens} tok` : ''})` : `ERROR: ${r.error.slice(0, 120)}`}`).join('\n')}

## Wyniki (uzupełnij po przeczytaniu .md plików)

| Model | Avg | Śląska A | Góralska Z | Humor | Norm.ludzie | Osob. | Gram. | # linii |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${results.map(r => `| \`${slug(r.model)}\` | __ | __ | __ | __ | __ | __ | __ | ${r.ok ? r.conversation.length : '-'} |`).join('\n')}
`;
if (toRun.length === MODELS.length) {
  fs.writeFileSync(path.join(__dirname, '_summary.md'), summary);
  console.log('\nWrote _summary.md');
} else {
  console.log('\nPartial run — _summary.md not rewritten.');
}
