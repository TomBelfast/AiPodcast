import { NextRequest, NextResponse } from 'next/server';
import { streamObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

const podcastSchema = z.object({
  conversation: z
    .array(
      z.object({
        speaker: z.enum(['Speaker1', 'Speaker2']),
        text: z.string(),
      })
    )
    .describe('A natural podcast conversation between two speakers'),
});

// POST - Process transcript and generate conversation
export async function POST(req: NextRequest) {
  try {
    const { jobId, transcript, title, language = 'en', metadata } = await req.json();

    if (!transcript || !jobId) {
      return NextResponse.json(
        { error: 'Transcript and jobId are required' },
        { status: 400 }
      );
    }

    // Validate language
    const validLanguages = ['en', 'pl', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'];
    const selectedLanguage = validLanguages.includes(language) ? language : 'en';

    // Use OpenRouter or OpenAI
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const useOpenRouter = !!openRouterApiKey;

    if (!openRouterApiKey && !openaiApiKey) {
      return NextResponse.json(
        { error: 'Either OPENROUTER_API_KEY or OPENAI_API_KEY must be configured' },
        { status: 500 }
      );
    }

    let openaiClient;
    if (useOpenRouter) {
      openaiClient = createOpenAI({
        apiKey: openRouterApiKey,
        baseURL: 'https://openrouter.ai/api/v1',
      } as any);
    } else {
      openaiClient = createOpenAI({
        apiKey: openaiApiKey,
      });
    }

    const modelName = useOpenRouter
      ? (process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini')
      : 'gpt-4o-mini';

    const model = openaiClient(modelName);

    // Language-specific instructions
    const languageNames: Record<string, string> = {
      en: 'English',
      pl: 'Polish',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      it: 'Italian',
      pt: 'Portuguese',
      ru: 'Russian',
      ja: 'Japanese',
      ko: 'Korean',
      zh: 'Chinese',
    };

    const languageName = languageNames[selectedLanguage] || 'English';

    // Generate conversation from transcript
    const result = await streamObject({
      model,
      schema: podcastSchema,
      prompt: `Convert the following transcript into a natural podcast conversation between two speakers (Speaker1 and Speaker2). 
      The conversation should be in ${languageName} language.
      Make it engaging, conversational, and natural. Add appropriate pauses, reactions, and dialogue flow.
      All dialogue should be in ${languageName}.

Transcript:
${transcript}

Title: ${title || 'Untitled Podcast'}
Language: ${languageName} (${selectedLanguage})`,
    });

    // Collect the full conversation
    let fullConversation: Array<{ speaker: string; text: string }> = [];
    for await (const chunk of result.partialObjectStream) {
      if (chunk.conversation && Array.isArray(chunk.conversation)) {
        fullConversation = chunk.conversation.map((item: any) => ({
          speaker: item.speaker || '',
          text: item.text || ''
        }));
      }
    }

    // Return conversation for approval
    const approvalUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/webhook/approve`;

    return NextResponse.json({
      success: true,
      jobId,
      conversation: fullConversation,
      title: title || 'Untitled Podcast',
      language: selectedLanguage,
      approvalUrl,
      message: 'Conversation generated. Please review and approve.',
    });
  } catch (error) {
    console.error('Error processing transcript:', error);
    return NextResponse.json(
      { error: 'Failed to process transcript' },
      { status: 500 }
    );
  }
}

