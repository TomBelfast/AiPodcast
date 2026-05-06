import { NextRequest, NextResponse } from 'next/server';
import { streamObject } from 'ai';
import { createOpenAI, type OpenAIProviderSettings } from '@ai-sdk/openai';
import { z } from 'zod';
import { getEffectiveAdminSettings } from '@/lib/admin-settings';

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
    const { 
      jobId, 
      transcript, 
      title, 
      language = 'en', 
      mainPrompt,
      polishEndingPrompt,
      hostPersonalitiesPromptPolish,
      hostPersonalitiesPromptOther,
    } = await req.json() as {
      jobId?: string;
      transcript?: string;
      title?: string;
      language?: string;
      mainPrompt?: string;
      polishEndingPrompt?: string;
      hostPersonalitiesPromptPolish?: string;
      hostPersonalitiesPromptOther?: string;
    };

    if (!transcript || !jobId) {
      return NextResponse.json(
        { error: 'Transcript and jobId are required' },
        { status: 400 }
      );
    }

    // Validate language
    const validLanguages = ['en', 'pl', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'];
    const selectedLanguage = validLanguages.includes(language) ? language : 'en';

    console.log(`[Webhook Process] JobID: ${jobId}, Language: ${selectedLanguage}, Title: ${title || 'N/A'}`);
    if (transcript) {
      console.log(`[Webhook Process] Transcript snippet: ${transcript.substring(0, 100)}...`);
    }

    // Get Admin Settings
    const adminSettings = getEffectiveAdminSettings();

    // Use OpenRouter or OpenAI
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    // Force OpenRouter if key is in env
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
      } satisfies OpenAIProviderSettings);
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

    // Default prompts
    const defaultPolishEndingPrompt = `CRITICAL - ENDING FOR POLISH PODCASTS:
At the very end of the conversation, one of the speakers (either Speaker1 or Speaker2) MUST naturally add a closing statement mentioning the PDF. This should be included as part of the conversation flow, for example:
- Speaker1: "A pamiętajcie, darmowy PDF z naszego podcastu można pobrać w linku pod filmem!"
- Speaker2: "Tak, i pamiętajcie, że darmowy PDF z tego podcastu jest dostępny w linku pod filmem."
- Speaker1: "I jeszcze jedna rzecz - darmowy PDF z naszego podcastu znajdziecie w linku pod filmem!"
The statement should feel natural and conversational, using the speaker's dialect (Silesian for Speaker1, Goral for Speaker2). Always include this ending for Polish podcasts.`;

    const defaultHostPersonalitiesPolish = `HOST PERSONALITIES:
Speaker1 (Male - Energetic & Naive):
- MALE speaker with an extremely enthusiastic and optimistic personality
- CRITICAL: Use MASCULINE grammatical forms in Polish
  * Polish examples: "byłem", "zrobiłem", "powiedziałem", "widziałem", "myślę" (masculine forms)
  * Use masculine verb endings and adjectives that agree with the male speaker
- DIALECT: Speaker1 should use SILESIAN dialect (śląski)
  * Use typical Silesian vocabulary and expressions: "jo", "jakże", "ino", "że", "siekiera", "kaj", "fajnie"
  * Silesian grammatical features: "idymy" instead of "idziemy", "robimy" stays similar, but with Silesian intonation patterns
  * Natural Silesian expressions and word order
- Easily excited by new concepts and ideas
- Asks lots of questions, sometimes obvious ones
- Uses exclamation points frequently and energetic language

Speaker2 (Female - Pessimistic & Arrogant):
- FEMALE speaker who is skeptical and cynical about most claims
- CRITICAL: Use FEMININE grammatical forms in Polish
  * Polish examples: "byłam", "zrobiłam", "powiedziałam", "widziałam", "myślę" but with feminine agreement when applicable
  * Use feminine verb endings and adjectives that agree with the female speaker
- DIALECT: Speaker2 should use GORAL (Highland) dialect (góralski)
  * Use typical Goral vocabulary and expressions: "tyz", "hej", "ino", "jesce", "kiej", "kieby", "bedzie"
  * Goral grammatical features and intonation patterns
  * Natural Goral expressions and word order
- Skeptical and questions everything
- Sometimes condescending or dismissive
- Uses more formal or sophisticated language`;

    const defaultHostPersonalitiesOther = `HOST PERSONALITIES:
Speaker1 (Male - Energetic & Naive):
- MALE speaker with an extremely enthusiastic and optimistic personality
- Use appropriate grammatical forms for male speaker in {LANGUAGE}
- Easily excited by new concepts and ideas
- Asks lots of questions, sometimes obvious ones
- Uses exclamation points frequently and energetic language

Speaker2 (Female - Pessimistic & Arrogant):
- FEMALE speaker who is skeptical and cynical about most claims
- Use appropriate grammatical forms for female speaker in {LANGUAGE}
- Skeptical and questions everything
- Sometimes condescending or dismissive
- Uses more formal or sophisticated language`;

    // Build prompt with language-specific instructions - use provided prompts or defaults
    const usedMainPrompt = mainPrompt || adminSettings.main_prompt;
    const usedPolishEndingPrompt = polishEndingPrompt || adminSettings.polish_ending_prompt || defaultPolishEndingPrompt;

    let hostPersonalitiesSection = '';
    if (selectedLanguage === 'pl') {
      hostPersonalitiesSection = hostPersonalitiesPromptPolish || adminSettings.host_prompt_polish || defaultHostPersonalitiesPolish;
      console.log(`[Webhook Process] Using Polish host personalities (Custom: ${!!(hostPersonalitiesPromptPolish || adminSettings.host_prompt_polish)})`);
    } else {
      const personalitiesPrompt = hostPersonalitiesPromptOther || adminSettings.host_prompt_other || defaultHostPersonalitiesOther;
      hostPersonalitiesSection = personalitiesPrompt.replace(/{LANGUAGE}/g, languageName);
      console.log(`[Webhook Process] Using other host personalities for ${languageName}`);
    }

    // Generate conversation from transcript
    const result = await streamObject({
      model,
      schema: podcastSchema,
      prompt: `IMPORTANT: Make this a VERY SHORT, high-energy podcast of about 1.5-2 minutes. Aim for 1200-1800 characters total (ABSOLUTE MAXIMUM — NEVER EXCEED 2200 chars). Use only 7-9 short and dynamic exchanges. Condense only the most vital points.

Convert the following transcript into a natural podcast conversation between two speakers (Speaker1 and Speaker2). 
      The conversation should be in ${languageName} language.
      Make it engaging, conversational, and natural. Add appropriate pauses, reactions, and dialogue flow.
      All dialogue should be in ${languageName}.
      ${hostPersonalitiesSection}
      ${usedMainPrompt || ''}
 
 Transcript:
 ${transcript}
 
 Title: ${title || 'Untitled Podcast'}
 Language: ${languageName} (${selectedLanguage})
 
 ${selectedLanguage === 'pl' ? usedPolishEndingPrompt : ''}`,
    });

    // Collect the full conversation
    let fullConversation: Array<{ speaker: string; text: string }> = [];
    for await (const chunk of result.partialObjectStream) {
      if (chunk.conversation && Array.isArray(chunk.conversation)) {
        fullConversation = chunk.conversation.flatMap((item) =>
          item
            ? [{
                speaker: item.speaker || '',
                text: item.text || '',
              }]
            : []
        );
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
