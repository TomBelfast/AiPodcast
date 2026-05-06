import { NextRequest, NextResponse } from "next/server";
import { createDialogue } from "@/actions/dialogue";
import { CreateDialogueRequest } from "@/types";
import {
  DEFAULT_ELEVENLABS_VOICES,
  DEFAULT_GEMINI_VOICES,
} from "@/lib/voice-catalog";
import {
  findNestedObject,
  isPlainObject,
  normalizeConversationDraft,
  normalizeGeminiStyle,
  normalizeGeminiTempo,
  normalizeTtsProvider,
  pickString,
  collectCandidateObjects,
} from "@/lib/podcast/contracts";
import { supabase } from "@/lib/supabase";
import { createGeminiDialogue } from "@/actions/gemini-tts";

function normalizeApiKey(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

export async function POST(request: NextRequest) {
  try {
    const parsedBody = await request.json();
    if (!isPlainObject(parsedBody)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }

    const body = parsedBody as CreateDialogueRequest & Record<string, unknown>;
    const candidates = collectCandidateObjects(body);
    const ttsCandidates = [
      ...candidates,
      ...candidates
        .map((candidate) => findNestedObject(candidate, 'tts'))
        .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate)),
    ];
    const provider = normalizeTtsProvider(
      pickString(ttsCandidates, ['provider', 'ttsProvider', 'tts_provider', 'ttsEngine', 'tts_engine']) ||
        body.provider ||
        body.ttsProvider ||
        body.ttsEngine ||
        "elevenlabs"
    );
    const geminiStyle = normalizeGeminiStyle(
      pickString(ttsCandidates, ['geminiStyle', 'gemini_style']) || body.geminiStyle
    );
    const geminiTempo = normalizeGeminiTempo(
      pickString(ttsCandidates, ['geminiTempo', 'gemini_tempo']) || body.geminiTempo
    );
    const language =
      pickString(candidates, ['language', 'lang', 'locale']) ||
      (typeof body.language === 'string' ? body.language.trim() : '') ||
      'en';

    // Verify user identity
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.split(' ')[1];
    const requestHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.hostname;
    const hostname = requestHost.split(':')[0].toLowerCase();
    const isLocalRequest = hostname === 'localhost' || hostname === '127.0.0.1';

    let userEmail = '';

    if (token) {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user) {
        userEmail = user.email || '';
      }
    }

    const isAdmin = userEmail === 'tomaszpasiekauk@gmail.com';

    const conversation = normalizeConversationDraft(body.conversation);
    const voice1 =
      pickString(ttsCandidates, ['voice1', 'voice_1']) ||
      (typeof body.voice1 === 'string' ? body.voice1.trim() : '') ||
      (provider === 'gemini'
        ? DEFAULT_GEMINI_VOICES.voice1
        : DEFAULT_ELEVENLABS_VOICES.voice1);
    const voice2 =
      pickString(ttsCandidates, ['voice2', 'voice_2']) ||
      (typeof body.voice2 === 'string' ? body.voice2.trim() : '') ||
      (provider === 'gemini'
        ? DEFAULT_GEMINI_VOICES.voice2
        : DEFAULT_ELEVENLABS_VOICES.voice2);

    if ((!body.inputs || body.inputs.length === 0) && conversation.length === 0) {
      return NextResponse.json(
        { error: "Either conversation or dialogue inputs are required" },
        { status: 400 }
      );
    }

    if (conversation.length > 0 && (!body.inputs || body.inputs.length === 0)) {
      body.inputs = conversation.map((item, index) => {
        const normalizedSpeaker = String(item.speaker || '').trim().toLowerCase();
        const mappedVoice =
          normalizedSpeaker === 'speaker2' ||
          normalizedSpeaker === 'zofia' ||
          normalizedSpeaker === 'hostb'
            ? voice2
            : index % 2 === 1 && normalizedSpeaker !== 'speaker1' && normalizedSpeaker !== 'antoni' && normalizedSpeaker !== 'hosta'
              ? voice2
              : voice1;

        return {
          text: item.text,
          voiceId: mappedVoice,
          speaker: item.speaker,
        };
      });
    }

    if (provider === 'omnivoice') {
      return NextResponse.json(
        {
          error: "Provider omnivoice is only supported in avatar video workflows. Use /api/podcast-video/podcast-film/jobs.",
        },
        { status: 501 }
      );
    }

    // Validate each dialogue input
    for (const input of body.inputs) {
      if (!input.text || !input.voiceId) {
        return NextResponse.json(
          { error: "Each dialogue input must have text and voiceId" },
          { status: 400 }
        );
      }
    }

    const modelOverride =
      pickString(ttsCandidates, ['model']) ||
      (typeof body.modelId === 'string' ? body.modelId.trim() : '') ||
      '';
    if (modelOverride) {
      body.modelId = modelOverride;
    }

    if (provider === "gemini") {
      body.provider = "gemini";
      body.language = language;
      body.geminiStyle = geminiStyle;
      body.geminiTempo = geminiTempo;
      body.tts = {
        ...(body.tts || {}),
        provider: 'gemini',
        geminiStyle,
        geminiTempo,
      };

      const { getEffectiveAdminSettings } = await import("@/lib/admin-settings");
      const adminSettings = getEffectiveAdminSettings();

      if (!body.apiKey) {
        body.apiKey = normalizeApiKey(
          pickString(ttsCandidates, ['apiKey', 'api_key']) || body.geminiApiKey
        );
      }

      if (!body.apiKey && (isAdmin || isLocalRequest)) {
        body.apiKey = normalizeApiKey(adminSettings.gemini_api_key);
      }

      if (!body.apiKey && !body.dryRun) {
        return NextResponse.json(
          {
            error: "Please complete your Gemini API Key before using Gemini TTS",
            code: "MISSING_GEMINI_KEY",
          },
          { status: 403 }
        );
      }

      body.apiKey = normalizeApiKey(body.apiKey);

      if (!body.apiKey && !body.dryRun) {
        return NextResponse.json(
          {
            error: "Please complete your Gemini API Key before using Gemini TTS",
            code: "MISSING_GEMINI_KEY",
          },
          { status: 403 }
        );
      }

      const result = await createGeminiDialogue(body);

      if (!result.ok) {
        const isMissingKey = result.error === "Gemini API key is missing.";
        return NextResponse.json(
          {
            error: isMissingKey ? "Please complete your Gemini API Key before using Gemini TTS" : result.error,
            ...(isMissingKey ? { code: "MISSING_GEMINI_KEY" } : {}),
          },
          { status: isMissingKey ? 403 : 500 }
        );
      }

      return NextResponse.json(result.value);
    }

    // 3. Get Admin Fallback Settings
    const { getEffectiveAdminSettings } = await import("@/lib/admin-settings");
    const adminSettings = getEffectiveAdminSettings();

    // Access Control Logic
    if (!body.apiKey) {
      body.apiKey = normalizeApiKey(
        pickString(ttsCandidates, ['apiKey', 'api_key']) || body.elevenlabsApiKey
      );
    }
    if (!body.apiKey) {
      if (isAdmin || !authHeader) {
        body.apiKey = adminSettings.elevenlabs_api_key;
      }
    }

    if (!body.apiKey) {
      return NextResponse.json(
        {
          error: "Please complete your ElevenLabs API Key in Settings",
          code: "MISSING_ELEVENLABS_KEY"
        },
        { status: 403 }
      );
    }

    if (body.includeTimestamps === undefined) {
      body.includeTimestamps = true;
    }

    const result = await createDialogue(body);

    if (!result.ok) {
      console.error("Error generating dialogue:", result.error);
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Parse to normalized format for convenience if requested or as a standard
    const { parseElevenLabsTranscript } = await import('@/lib/transcript-parser');
    const parsedTranscript = parseElevenLabsTranscript({
      ...result.value,
      conversation: body.inputs.map(i => ({ speaker: '', text: i.text })), // Simplified mapping for TTS-only
    });

    console.log(`[ElevenLabs] Audio generated successfully. Characters used: ${result.value.charactersUsed || 'unknown'}`);
    
    return NextResponse.json({
      audioBase64: result.value.audioBase64,
      voiceSegments: result.value.voiceSegments,
      alignment: result.value.alignment,
      normalizedAlignment: result.value.normalizedAlignment,
      transcript: parsedTranscript,
      processingTimeMs: result.value.processingTimeMs,
      charactersUsed: result.value.charactersUsed,
    });
  } catch (error) {
    console.error("Error processing dialogue request:", error);
    return NextResponse.json(
      { error: "Failed to process dialogue request" },
      { status: 500 }
    );
  }
}
