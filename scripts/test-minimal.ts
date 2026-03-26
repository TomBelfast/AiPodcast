import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

console.log('Minimal script started');
console.log('Environment:', process.env.OPENROUTER_API_KEY ? 'Present' : 'Missing');
console.log('Path:', process.cwd());
