import { NextResponse } from "next/server";
import { getElevenLabsClient } from "@/app/actions/utils";
import { GEMINI_VOICE_OPTIONS, OPENROUTER_VOICE_OPTIONS, VoiceOption } from "@/lib/voice-catalog";

interface ElevenLabsVoice {
  voice_id?: string;
  id?: string;
  voiceId?: string;
  voiceID?: string;
  name?: string;
  category?: string;
  description?: string;
  labels?: {
    gender?: string;
  };
}

interface ElevenLabsVoiceResponse {
  voices?: ElevenLabsVoice[];
}

function normalizeGenderBucket(value: string | undefined): VoiceOption["genderBucket"] {
  const normalized = String(value || "").toLowerCase();

  if (normalized === "male" || normalized === "m") {
    return "male";
  }

  if (normalized === "female" || normalized === "f") {
    return "female";
  }

  return "unknown";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const provider = String(searchParams.get("provider") || "elevenlabs").toLowerCase();

  if (provider === "gemini") {
    return NextResponse.json({
      provider: "gemini",
      voices: GEMINI_VOICE_OPTIONS,
      curatedGenderBuckets: true,
    });
  }

  if (provider === "openrouter") {
    return NextResponse.json({
      provider: "openrouter",
      voices: OPENROUTER_VOICE_OPTIONS,
      curatedGenderBuckets: true,
    });
  }

  try {
    const clientResult = await getElevenLabsClient();
    
    if (!clientResult.ok) {
      return NextResponse.json(
        { error: clientResult.error },
        { status: 500 }
      );
    }

    const client = clientResult.value;
    const voicesResponse = await client.voices.getAll() as ElevenLabsVoice[] | ElevenLabsVoiceResponse;

    // Handle different response structures - voicesResponse might be the array directly or have a .voices property
    const voicesArray = Array.isArray(voicesResponse) 
      ? voicesResponse 
      : voicesResponse.voices || [];

    // Map voices to a simpler format - handle different possible property names
    const voicesList: VoiceOption[] = voicesArray.map((voice) => {
      // Try multiple possible property names for voice ID
      // Based on ElevenLabs API, it should be 'voice_id' in snake_case
      const voiceId = voice.voice_id || voice.id || voice.voiceId || voice.voiceID || '';
      
      return {
        id: voiceId,
        name: voice.name || '',
        provider: 'elevenlabs' as const,
        category: voice.category || 'unknown',
        description: voice.description || '',
        genderBucket: normalizeGenderBucket(voice.labels?.gender),
      };
    }).filter((voice) => voice.id); // Filter out voices without ID

    return NextResponse.json({ provider: 'elevenlabs', voices: voicesList });
  } catch (error) {
    console.error("Error fetching voices:", error);
    return NextResponse.json(
      { error: "Failed to fetch voices" },
      { status: 500 }
    );
  }
}
