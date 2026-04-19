import { NextRequest, NextResponse } from "next/server";
import { streamObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const {
      content,
      title,
      language = 'en',
      mainPrompt,
      polishEndingPrompt,
      hostPersonalitiesPromptPolish,
      hostPersonalitiesPromptOther,
      openaiApiKey: userOpenaiApiKey, // Added: Extract key from request
      ttsEngine,
    } = await req.json();

    const ttsEngineNormalized = String(ttsEngine || 'elevenlabs').toLowerCase();
    const isTtsOmnivoice = ttsEngineNormalized === 'omnivoice';

    const podcastSchema = z.object({
      conversation: z
        .array(
          z.object({
            speaker: z.enum(["Speaker1", "Speaker2", "Antoni", "Zofia"]),
            text: z
              .string()
              .describe(
                isTtsOmnivoice
                  ? "The text spoken by this speaker. Plain speakable sentences only. No bracketed stage directions, no emotional annotations, no em-dash interruptions, no non-verbal cues."
                  : "The text spoken by this speaker, including natural speech patterns and nuances like [laughs], [pauses], [excited], etc."
              ),
          })
        )
        .describe(
          "A natural podcast conversation between two speakers discussing the content"
        ),
    });

    if (!content) {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
      );
    }

    // Verify user identity
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.split(' ')[1];

    let userEmail = '';

    if (token) {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user?.email) {
        userEmail = user.email;
      }
    }

    const isAdmin = userEmail === 'tomaszpasiekauk@gmail.com';

    // Access Control Logic

    // 3. Get Admin Fallback Settings
    const { getEffectiveAdminSettings } = await import("@/lib/admin-settings");
    const adminSettings = getEffectiveAdminSettings();

    // Determine final key to use
    // 1. Prioritize user key from request (if any)
    // 2. Fall back to admin settings if user is admin OR if this is a session-less request (webhook)
    let apiKey = userOpenaiApiKey;
    if (!apiKey && (isAdmin || !authHeader)) {
      apiKey = adminSettings.openai_api_key;
    }

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "Please complete your API Key in Settings",
          code: "MISSING_OPENAI_KEY"
        },
        { status: 403 }
      );
    }

    const isOpenRouterKey = apiKey?.startsWith('sk-or-');
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;

    // Use OpenRouter if:
    // 1. Key explicitly starts with 'sk-or-'
    // 2. OR if we have an OPENROUTER_API_KEY env var (Force Gemini as default if set)
    const useOpenRouter = isOpenRouterKey || !!openRouterApiKey;

    let openaiClient;
    const provider = useOpenRouter ? 'OpenRouter' : 'OpenAI';

    if (useOpenRouter) {
      // Configure OpenRouter (compatible with OpenAI API)
      openaiClient = createOpenAI({
        apiKey: openRouterApiKey || apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
      } as any);
    } else {
      // Fallback to OpenAI
      openaiClient = createOpenAI({
        apiKey: apiKey,
      });
    }

    // Use a model available on OpenRouter (or OpenAI if not using OpenRouter)
    // OpenRouter format: openai/gpt-4o-mini, anthropic/claude-3.5-sonnet, etc.
    const modelName = useOpenRouter
      ? (process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini')
      : 'gpt-4o-mini';

    const model = openaiClient(modelName);

    // Determine language name
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
    const languageName = languageNames[language] || 'English';
    const isPolish = language === 'pl';

    // Use prompts from request or fallback to defaults
    const defaultMainPrompt = `CRITICAL - NUMBERS MUST BE WRITTEN AS WORDS: Always write all numbers, percentages, years, quantities, and measurements as full words in the conversation text. This is essential for proper text-to-speech conversion.

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
- If unsure about grammar, use simpler but correct constructions rather than complex but incorrect ones`;

    const defaultPolishEndingPrompt = ``;

    const defaultHostPersonalitiesPolish = `TOP PRIORITY — STYL ROGANA (JAK W JOE ROGAN PODCAST):
Dialog MUSI być dynamiczny i szybki jak w najlepszych odcinkach Rogana z ciężkim
polskim humorem. NIE jest to suchy komentarz newsowy. To pyskówka dwojga
kolegów w pubie.

TWARDE ZASADY DŁUGOŚCI (cel: podcast 1.5-2.5 minuty):
- Każda kwestia MAX 2-3 zdania. MAX 220 znaków na kwestię.
- ŻADNYCH długich tyrad ani pompatycznych wywodów — ale fakt + pointa OK.
- Dialog dynamiczny, "ping-pong": reakcja, pointa, reakcja, pointa.
- Total: DOKŁADNIE 10 wymian (5 Antoni + 5 Zofia). Nie mniej.
- Łącznie cały dialog 1600-2200 znaków (to daje ~1.5-2.5 min w TTS).

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
  pierona, rychtyg, siekiera, łokno, cza, żech, czytoł, pieruńsko.
- Signature: "Jo Ci godom…", "Kaj tam…", "Rychtyg…", "Pierona!".
- Wyciąga absurdalne konsekwencje hype'u. Pyta naiwne pytania.

Zofia (Female - Sarcastic & Cynical):
- Sarkastyczna, cyniczna, sucha. Zbija entuzjazm jednym zdaniem.
- FEMININE grammatical forms: "byłam", "zrobiłam", "widziałam".
- ADDRESSING ANTONI: MASCULINE formy: "słyszałeś", "mógłbyś".
- DIALEKT GÓRALSKI — MIN. 2 wyrazy góralskie z listy w KAŻDEJ kwestii:
  tyż, hej, ino, jesce, kiej, kiebyś, som, robia, pado, jako, bedzie,
  dyć, ftory, juści, kozdy, wom, mosz, fcora.
- Signature: "Hej Antoni…", "Tyż mi…", "Dyć…", "Kiebyś pomyślał…".
- Nie moralizuje — żartuje. Jedna sarkastyczna pointa wystarczy.

PRZYKŁAD WZORCOWEJ WYMIANY ROGAN-STYLE (naśladuj tempo, nie słowa):
Antoni: "Jo Ci godom, siekiera jak oni ten model wypuścili — cołki internet szaleje!"
Zofia: "Hej, tyż mi szał — jesce wczoraj obiecywali że stary wszystko ogarnie."
Antoni: "Pieruńsko, trzy razy lepij obrazki rozumi! Rychtyg czary!"
Zofia: "Czary, juści. Kiej zmienisz mu jeden przecinek, zapomina co widzioł."
Antoni: "Ale godom, automatyzuje cołki workflow w chmurze, fajnie nie?"
Zofia: "Fajnie, dyć kiebyś przeczytoł cennik, to byś se na kawę nie odłożył."
Antoni: "A ten Mythos sekretny? Pierona, ukrywajom przed nami bombę!"
Zofia: "Hej, kozdy tak robi — hype najpierw, kod potem, prawda na końcu."

Zauważ: krótko, szybko, każda kwestia = gwara + pointa + reakcja. Rogan
by przybił piątkę.`;

    const defaultHostPersonalitiesOther = `HOST PERSONALITIES:
Speaker1 (Male - Energetic & Naive):
- MALE speaker with an extremely enthusiastic and optimistic personality
- CRITICAL: Use MASCULINE grammatical forms in {LANGUAGE} (for languages with gender inflection)
  * Use appropriate masculine grammatical forms, verb endings and adjectives that agree with the male speaker
- Easily excited by new concepts and ideas
- Asks lots of questions, sometimes obvious ones
- Uses exclamation points frequently and energetic language
- Tends to see the bright side of everything
- Sometimes misses subtleties or nuances
- Quick to get excited: "Oh wow!", "That's amazing!", "I had no idea!"

Speaker2 (Female - Pessimistic & Arrogant):
- FEMALE speaker who is skeptical and cynical about most claims
- CRITICAL: Use FEMININE grammatical forms in {LANGUAGE} (for languages with gender inflection)
  * Use appropriate feminine grammatical forms, verb endings and adjectives that agree with the female speaker
- Knows everything (or thinks they do)
- Often corrects or challenges Speaker1
- Uses condescending language and sighs frequently
- Points out flaws, problems, and downsides
- Makes sarcastic comments and eye-rolls
- Tends to be contrarian: "Actually...", "Well, obviously...", "That's not quite right..."`;

    // Use prompts from request or fallback to defaults
    const usedMainPrompt = mainPrompt || adminSettings.main_prompt || defaultMainPrompt;
    const usedPolishEndingPrompt = polishEndingPrompt || adminSettings.polish_ending_prompt || defaultPolishEndingPrompt;

    // Build host personalities section - use provided prompts or defaults
    let hostPersonalitiesSection = '';
    if (isPolish) {
      hostPersonalitiesSection = hostPersonalitiesPromptPolish || adminSettings.host_prompt_polish || defaultHostPersonalitiesPolish;
    } else {
      const personalitiesPrompt = hostPersonalitiesPromptOther || adminSettings.host_prompt_other || defaultHostPersonalitiesOther;
      hostPersonalitiesSection = personalitiesPrompt.replace(/{LANGUAGE}/g, languageName);
    }

    console.log(`[Generate Podcast] Request starting: title="${title || 'Article'}", language="${language}"`);
    console.log(`[Generate Podcast] Models: ${modelName} via ${provider}`);
    console.log(`[Generate Podcast] Host Personalities Section starts with: ${hostPersonalitiesSection.substring(0, 50)}...`);

    let result;
    try {
      console.log(`[Generate Podcast] Calling LLM with prompt length: ${300 + hostPersonalitiesSection.length + usedMainPrompt.length}...`);
      
      const ttsGuard = isTtsOmnivoice
        ? `CRITICAL TTS RULES (OmniVoice output — overrides ANY conflicting instruction later in this prompt):
- Do NOT include emotional annotations like [laughs], [chuckles], [sighs], [excited], [surprised], [skeptical], [thoughtful], [confused], [amazed], [eye roll], [pauses], or any bracketed stage directions.
- Do NOT use em-dashes (—) to show interruptions. Do not truncate sentences with dashes. Every line must be a complete, self-contained sentence.
- No non-verbal cues, no action descriptions, no parenthetical asides.
- Output only clean speakable text a neural TTS will read aloud verbatim.

`
        : '';

      result = await streamObject({
        model,
        schema: podcastSchema,
        prompt: `${ttsGuard}IMPORTANT: Make this a VERY SHORT, high-energy podcast of about 1.5-2 minutes. Aim for 1200-1800 characters total (ABSOLUTE MAXIMUM — NEVER EXCEED 2200 chars). Use only 7-9 short and dynamic exchanges. Condense only the most vital points.

Create a highly dynamic, natural podcast conversation in ${languageName} between Antoni and Zofia based on the provided content.

Title: ${title || "Article"}
Content: ${content}

${hostPersonalitiesSection}
${usedMainPrompt || ''}

${isPolish ? usedPolishEndingPrompt : ''}`,
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
