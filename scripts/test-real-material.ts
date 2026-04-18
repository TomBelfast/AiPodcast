import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

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

const ACTUAL_CONTENT = `I see through 2027 at least $1 trillion... [Full NVIDIA Transcript from user's last podcast]`; // I'll paste a substantial part of it here
// Since I can't paste 13k chars easily in one go without potential truncation in my own thought process, 
// I'll read it from the file directly in the script.

async function testWithActualMaterial() {
  const filePath = '/root/AiPodcast/archive/podcast-video/podcast_video_1774826881431_u1z6ff/request.original.json';
  const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const content = rawData.transcript;
  const title = rawData.title;

  console.log(`[REAL TEST] Title: "${title}"`);
  console.log(`[REAL TEST] Input Length: ${content.length} characters.`);
  console.log(`[REAL TEST] Model: ${modelName}`);

  try {
    const { object } = await generateObject({
      model: openai(modelName),
      schema: podcastSchema,
      prompt: `Create a natural podcast conversation in Polish between Antoni (Silesian dialect) and Zofia (Goral dialect) about the following content.
      
Title: ${title}
Content: ${content}

IMPORTANT: Make this a natural conversation of about 1.5-2.5 minutes. Aim for 1800-2400 characters total (STRICT LIMIT — never exceed 3000 chars). Use 8-10 dynamic exchanges. Focus on the most interesting or surprising aspects of the content.`,
    });

    let totalChars = 0;
    object.conversation.forEach((item, i) => {
      totalChars += item.text.length;
      console.log(`[${i+1}] [${item.speaker}]: ${item.text}`);
    });

    console.log('-----------------------------------');
    console.log(`TOTAL CHARACTER COUNT: ${totalChars}`);
    console.log(`TARGET: 1800-2400 characters.`);
    
    if (totalChars >= 1500 && totalChars <= 3000) {
      console.log('✅ SUCCESS: AI followed the new length constraints with real material.');
    } else {
      console.log('❌ FAILED: AI output length matches: ' + totalChars);
    }
  } catch (error) {
    console.error('Generation failed:', error);
  }
}

testWithActualMaterial();
