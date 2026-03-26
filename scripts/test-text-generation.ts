import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

console.log('--- SCRIPT STARTING ---');

// Load .env manually if needed
function loadEnv() {
  try {
    let envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
      envPath = path.join(process.cwd(), '.env.local');
    }
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('#')) return;
        const [key, ...valueParts] = trimmedLine.split('=');
        const value = valueParts.join('=');
        if (key && value) {
          process.env[key.trim()] = value.trim();
        }
      });
    }
  } catch (e) {
    console.error('Error loading .env:', e);
  }
}

loadEnv();

const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Error: OPENROUTER_API_KEY or OPENAI_API_KEY not found in .env');
  process.exit(1);
}

const modelName = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const baseURL = apiKey.startsWith('sk-or-') ? 'https://openrouter.ai/api/v1' : undefined;

const openai = createOpenAI({
  apiKey,
  baseURL,
});

const podcastSchema = z.object({
  conversation: z.array(
    z.object({
      speaker: z.enum(['Antoni', 'Zofia']),
      text: z.string(),
    })
  ),
});

const mainPrompt = `CRITICAL - NUMBERS MUST BE WRITTEN AS WORDS: Always write all numbers, percentages, years, quantities, and measurements as full words in the conversation text. 

CRITICAL: Make this conversation feel REAL and DYNAMIC with interruptions, emotional reactions, and natural flow.

GRAMMATICAL ACCURACY:
- Antoni (MALE) must use MASCULINE grammatical forms in Polish.
- Zofia (FEMALE) must use FEMININE grammatical forms in Polish.
- Addressing each other: Antoni uses feminine forms for Zofia, Zofia uses masculine for Antoni.`;

const hostPersonalitiesPolish = `HOST PERSONALITIES:
Antoni (Male - Energetic & Naive):
- DIALECT: Antoni should use SILESIAN dialect (śląski)
- Use typical Silesian vocabulary: "jo", "kaj", "fajnie", "żodyn", "gryfnie", "onacyć", "chopa"
- Energetic, enthusiastic, misses subtleties.

Zofia (Female - Pessimistic & Arrogant):
- DIALECT: Zofia should use GORAL (Highland) dialect (góralski)
- Use typical Goral vocabulary: "tyz", "hej", "ino", "jesce", "kiej", "kieby", "bedzie", "bacówka"
- Skeptical, cynical, corrections Antoni frequently.`;

const polishEndingPrompt = `CRITICAL - ENDING:
At the very end, one of them MUST mention that a free PDF is available in the link below the video. 
Antoni: "A pamiętejcie, darmowy PDF z naszego podcastu idzie pobrać w linku pod filmem!"
Zofia: "Hej, i pamiętajcie, że darmowy PDF z tego podcastu jest dostępny w linku pod filmem."`;

async function testGeneration() {
  const content = process.argv[2] || "Dzisiejszy temat to porównanie życia w Katowicach i w Zakopanem. Czy lepiej pić piwo na Mariackiej czy oscypka na Krupówkach?";
  const title = "Śląsk vs Góry";

  console.log(`Generating podcast for title: "${title}"...`);
  console.log(`Content: "${content}"`);
  console.log(`Using model: ${modelName} via ${baseURL || 'OpenAI'}`);
  console.log('-----------------------------------');

  try {
    console.log('Sending request to LLM...');
    const { object } = await generateObject({
      model: openai(modelName),
      schema: podcastSchema,
      prompt: `Create a highly dynamic, natural podcast conversation in Polish between Antoni and Zofia.
      
Title: ${title}
Content: ${content}

${hostPersonalitiesPolish}
${mainPrompt}
${polishEndingPrompt}

IMPORTANT: Max 10-15 exchanges. Focus on the dialectal differences and personality clash.`,
    });

    console.log('LLM response received!');
    console.log('GENERTED CONVERSATION:');
    object.conversation.forEach((item, i) => {
      console.log(`[${item.speaker}]: ${item.text}`);
    });
    console.log('-----------------------------------');
    console.log('Test complete.');
  } catch (error) {
    console.error('Generation failed:', error);
  }
}

console.log('Script started...');
testGeneration();
