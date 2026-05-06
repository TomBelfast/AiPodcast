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

async function verifyDuration() {
  const content = "Sztuczna inteligencja zmienia świat, od medycyny po sztukę. Niektórzy się boją, inni witają zmiany z entuzjazmem. Dzisiaj porozmawiamy o tym, jak AI wpływa na polską kulturę i codzienne życie.";
  const title = "AI w Polsce";

  console.log(`[TEST] Generating podcast with new constraints (1.5-2.5 min)...`);
  
  try {
    const { object } = await generateObject({
      model: openai(modelName),
      schema: podcastSchema,
      prompt: `Create a natural podcast conversation in Polish between Antoni and Zofia.
      
Title: ${title}
Content: ${content}

IMPORTANT: Make this a natural conversation of about 1.5-2.5 minutes. Aim for 1800-2400 characters total (STRICT LIMIT — never exceed 3000 chars). Use 8-10 dynamic exchanges.`,
    });

    let totalChars = 0;
    object.conversation.forEach((item) => {
      totalChars += item.text.length;
      console.log(`[${item.speaker}]: ${item.text}`);
    });

    console.log('-----------------------------------');
    console.log(`TOTAL CHARACTER COUNT: ${totalChars}`);
    console.log(`TARGET: 1800-2400 characters.`);
    
    if (totalChars >= 1500 && totalChars <= 3000) {
      console.log('✅ TEST PASSED: Duration is within or close to target range.');
    } else {
      console.log('❌ TEST FAILED: Duration is too far from target range.');
    }
  } catch (error) {
    console.error('Generation failed:', error);
  }
}

verifyDuration();
