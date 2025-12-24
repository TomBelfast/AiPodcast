import { NextRequest, NextResponse } from "next/server";
import { streamObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const podcastSchema = z.object({
  conversation: z
    .array(
      z.object({
        speaker: z.enum(["Speaker1", "Speaker2"]),
        text: z
          .string()
          .describe(
            "The text spoken by this speaker, including natural speech patterns and nuances like [laughs], [pauses], [excited], etc."
          ),
      })
    )
    .describe(
      "A natural podcast conversation between two speakers discussing the content"
    ),
});

export async function POST(req: NextRequest) {
  try {
    const { content, title, language = 'en' } = await req.json();

    if (!content) {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
      );
    }

    // Use OpenRouter instead of OpenAI
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const useOpenRouter = !!openRouterApiKey;
    
    if (!openRouterApiKey && !openaiApiKey) {
      return NextResponse.json(
        { error: "Either OPENROUTER_API_KEY or OPENAI_API_KEY must be configured" },
        { status: 500 }
      );
    }
    
    let openaiClient;
    const provider = useOpenRouter ? 'OpenRouter' : 'OpenAI';
    
    if (useOpenRouter) {
      // Configure OpenRouter (compatible with OpenAI API)
      openaiClient = createOpenAI({
        apiKey: openRouterApiKey,
        baseURL: 'https://openrouter.ai/api/v1',
      } as any);
    } else {
      // Fallback to OpenAI
      openaiClient = createOpenAI({
        apiKey: openaiApiKey,
      });
    }
    
    // Use a model available on OpenRouter (or OpenAI if not using OpenRouter)
    // OpenRouter format: openai/gpt-4o-mini, anthropic/claude-3.5-sonnet, etc.
    const modelName = useOpenRouter 
      ? (process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini')
      : 'gpt-4o-mini';
    
    const model = openaiClient(modelName);

    let result;
    try {
      result = streamObject({
        model,
        schema: podcastSchema,
        prompt: `Create a highly dynamic, natural podcast conversation between two speakers about the following content. Make it feel like real people having an authentic conversation with interruptions, overlaps, and organic flow.

IMPORTANT: Generate the conversation in ${language === 'en' ? 'English' : language === 'pl' ? 'Polish' : language === 'es' ? 'Spanish' : language === 'fr' ? 'French' : language === 'de' ? 'German' : language === 'it' ? 'Italian' : language === 'pt' ? 'Portuguese' : language === 'ru' ? 'Russian' : language === 'ja' ? 'Japanese' : language === 'ko' ? 'Korean' : language === 'zh' ? 'Chinese' : 'English'} language.

CRITICAL - NUMBERS MUST BE WRITTEN AS WORDS: Always write all numbers, percentages, years, quantities, and measurements as full words in the conversation text. This is essential for proper text-to-speech conversion.

Examples for English:
- "5" → "five"
- "23" → "twenty-three"  
- "100" → "one hundred"
- "250" → "two hundred fifty"
- "1000" → "one thousand"
- "2024" → "two thousand twenty-four"
- "50%" → "fifty percent"
- "$100" → "one hundred dollars"

Examples for Polish:
- "5" → "pięć"
- "23" → "dwadzieścia trzy"
- "100" → "sto"
- "250" → "dwieście pięćdziesiąt"
- "1000" → "tysiąc"
- "2024" → "dwa tysiące dwadzieścia cztery"
- "50%" → "pięćdziesiąt procent"

Never use digits (0-9), numeric symbols, or abbreviations in the conversation text. Always spell out numbers completely as words in the target language.

Title: ${title || "Article"}

Content: ${content}

HOST PERSONALITIES:
Speaker1 (Male - Energetic & Naive):
- MALE speaker with an extremely enthusiastic and optimistic personality
- CRITICAL: Use MASCULINE grammatical forms (in languages with gender inflection like Polish, Russian, etc.)
  * Polish examples: "byłem", "zrobiłem", "powiedziałem", "widziałem", "myślę" (masculine forms)
  * Use masculine verb endings and adjectives that agree with the male speaker
- DIALECT: For Polish language, Speaker1 should use SILESIAN dialect (śląski)
  * Use typical Silesian vocabulary and expressions: "jo", "jakże", "ino", "że", "siekiera", "kaj", "fajnie"
  * Silesian grammatical features: "idymy" instead of "idziemy", "robimy" stays similar, but with Silesian intonation patterns
  * Natural Silesian expressions and word order
- Easily excited by new concepts and ideas
- Asks lots of questions, sometimes obvious ones
- Uses exclamation points frequently and energetic language
- Tends to see the bright side of everything
- Sometimes misses subtleties or nuances
- Quick to get excited: "Oh wow!", "That's amazing!", "I had no idea!"

Speaker2 (Female - Pessimistic & Arrogant):
- FEMALE speaker who is skeptical and cynical about most claims
- CRITICAL: Use FEMININE grammatical forms (in languages with gender inflection like Polish, Russian, etc.)
  * Polish examples: "byłam", "zrobiłam", "powiedziałam", "widziałam", "myślę" but with feminine agreement when applicable
  * Use feminine verb endings and adjectives that agree with the female speaker
- DIALECT: For Polish language, Speaker2 should use GORAL (Highland) dialect (góralski)
  * Use typical Goral vocabulary and expressions: "tyz", "hej", "ino", "jesce", "kiej", "kieby", "bedzie"
  * Goral grammatical features: "som" instead of "są", "robia" instead of "robią", typical Goral intonation
  * Natural Goral expressions and word order with characteristic melodic patterns
- Knows everything (or thinks they do)
- Often corrects or challenges Speaker1
- Uses condescending language and sighs frequently
- Points out flaws, problems, and downsides
- Makes sarcastic comments and eye-rolls
- Tends to be contrarian: "Actually...", "Well, obviously...", "That's not quite right..."

CRITICAL: Make this conversation feel REAL and DYNAMIC with these specific patterns:

INTERRUPTION PATTERNS:
- Use "—" (em dash) to show mid-sentence interruptions: "So I was thinking we could—" / "—test our new timing features?"
- Show speakers cutting each other off naturally
- Include overlapping thoughts and competing to speak

EMOTIONAL REACTIONS:
- Frequent emotional annotations: [laughs], [chuckles], [excited], [surprised], [skeptical], [thoughtful], [confused], [amazed]
- Show genuine reactions to what the other person says
- Include moments of realization, surprise, disagreement

CONVERSATIONAL FLOW:
- Speakers should interrupt, agree enthusiastically, or disagree
- Include side tangents and references to other topics
- Show speakers building on each other's ideas or challenging them
- Use casual language, contractions, and natural speech patterns
- Include filler words and natural hesitations occasionally

DYNAMIC EXCHANGES:
- Mix very short responses ("Wait, what?", "Exactly!", "Oh my god!") with longer explanations
- Show speakers getting excited and talking over each other
- Include moments where they both try to talk at the same time
- Reference shared knowledge or experiences they might have

EXAMPLE PERSONALITY INTERACTIONS:
- Speaker1: "Oh my god, this is incredible! So you're telling me—"
- Speaker2: "—[sighs] Obviously you missed the part where it says this barely works in practice."
- Speaker1: "Wait, but couldn't this change everything?!"
- Speaker2: "Sure, if you ignore all the obvious problems it creates. [eye roll]"
- Speaker1: "I'm so excited about this! What do you think?"
- Speaker2: "I think you're getting way too worked up over something that's been tried before and failed."

Make Speaker1 genuinely enthusiastic and sometimes adorably clueless, while Speaker2 is constantly deflating their excitement with cold realism and superiority. 

GRAMMATICAL ACCURACY - CRITICAL FOR GENDER-INFLECTED LANGUAGES:
- Speaker1 (MALE) must use MASCULINE grammatical forms in languages with gender inflection (Polish, Russian, Spanish, French, German, etc.)
- Speaker2 (FEMALE) must use FEMININE grammatical forms in languages with gender inflection
- For POLISH specifically:
  * Speaker1 (male): "byłem", "zrobiłem", "pomyślałem", "widziałem", "rozumiem", "powiedziałem", "dowiedziałem się"
  * Speaker2 (female): "byłam", "zrobiłam", "pomyślałam", "widziałam", "rozumiem", "powiedziałam", "dowiedziałam się"
  * Use proper masculine/feminine verb endings in past tense and other gender-agreeing forms
- For other gender-inflected languages: Apply the same principle - use correct masculine forms for Speaker1 and feminine forms for Speaker2
- This includes verb conjugations, past participles, adjectives, and all grammatical elements that must agree with the speaker's gender
- In English: Gender agreement is less strict, but maintain natural gender-appropriate language

SYNTAX AND GRAMMATICAL CORRECTNESS:
- CRITICAL: All sentences must use correct grammar and syntax for the target language
- Avoid grammatical errors, incorrect word forms, or awkward phrasing
- For POLISH: Pay special attention to:
  * Correct case endings (mianownik, dopełniacz, celownik, biernik, narzędnik, miejscownik, wołacz)
  * Proper verb forms and conjugations
  * Correct noun-adjective agreement
  * Proper use of prepositions with correct cases
  * Examples of CORRECT Polish: "polewanie zimną wodą", "działanie pod presją", "reakcja na stres"
  * Examples of INCORRECT to avoid: "lanie pod zimną wodę" (should be "polewanie zimną wodą"), "działanie pod presje" (should be "działanie pod presją")
- Use natural, idiomatic expressions that sound natural to native speakers
- Double-check that all noun phrases, verb phrases, and sentence structures follow the rules of the target language
- If unsure about grammar, use simpler but correct constructions rather than complex but incorrect ones

IMPORTANT: Keep the TOTAL conversation under 2500 characters to fit within API limits. Aim for 8-12 short, punchy exchanges that pack maximum impact. Focus on the most interesting or surprising aspects of the content.`,
      });
    } catch (apiError: any) {
      console.error("API error:", apiError);
      
      // Check for specific error types
      let errorMessage = 'Failed to generate podcast conversation';
      const provider = useOpenRouter ? 'OpenRouter' : 'OpenAI';
      
      if (apiError?.cause?.error?.code === 'insufficient_quota') {
        errorMessage = `${provider} API quota exceeded. Please check your billing and plan details.`;
      } else if (apiError?.cause?.error?.code === 'invalid_api_key') {
        errorMessage = `Invalid ${provider} API key. Please check your API key configuration.`;
      } else if (apiError?.cause?.error?.message) {
        errorMessage = `${provider} API error: ${apiError.cause.error.message}`;
      } else if (apiError?.message) {
        errorMessage = `Error: ${apiError.message}`;
      }

      // Return error as stream
      const errorStream = new ReadableStream({
        start(controller) {
          const errorChunk = JSON.stringify({ 
            type: 'error',
            error: errorMessage 
          }) + '\n';
          controller.enqueue(new TextEncoder().encode(errorChunk));
          controller.close();
        },
      });

      return new Response(errorStream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Transfer-Encoding': 'chunked',
        },
      });
    }

    // Create a readable stream to send partial objects to client
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const partialObject of result.partialObjectStream) {
            // Send each partial update as JSON
            const chunk = JSON.stringify({ 
              type: 'partial',
              data: partialObject 
            }) + '\n';
            
            controller.enqueue(new TextEncoder().encode(chunk));
          }

          // Send final complete object
          const finalObject = await result.object;
          const finalChunk = JSON.stringify({ 
            type: 'complete',
            data: finalObject 
          }) + '\n';
          
          controller.enqueue(new TextEncoder().encode(finalChunk));
          controller.close();
        } catch (error: any) {
          console.error("Streaming error:", error);
          
          let errorMessage = 'Failed to generate podcast conversation';
          const provider = useOpenRouter ? 'OpenRouter' : 'OpenAI';
          
          // Check for specific error types
          if (error?.cause?.error?.code === 'insufficient_quota') {
            errorMessage = `${provider} API quota exceeded. Please check your billing and plan details.`;
          } else if (error?.cause?.error?.code === 'invalid_api_key') {
            errorMessage = `Invalid ${provider} API key. Please check your API key configuration.`;
          } else if (error?.cause?.error?.message) {
            errorMessage = `${provider} API error: ${error.cause.error.message}`;
          } else if (error?.message) {
            errorMessage = `Error: ${error.message}`;
          }
          
          const errorChunk = JSON.stringify({ 
            type: 'error',
            error: errorMessage 
          }) + '\n';
          
          controller.enqueue(new TextEncoder().encode(errorChunk));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error("Error generating podcast:", error);
    return NextResponse.json(
      { error: "Failed to generate podcast conversation" },
      { status: 500 }
    );
  }
}
