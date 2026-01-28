import { NextResponse } from "next/server";
import { getElevenLabsClient } from "@/app/actions/utils";

export async function GET() {
  try {
    const clientResult = await getElevenLabsClient();
    
    if (!clientResult.ok) {
      return NextResponse.json(
        { error: clientResult.error },
        { status: 500 }
      );
    }

    const client = clientResult.value;
    const voicesResponse = await client.voices.getAll();

    // Handle different response structures - voicesResponse might be the array directly or have a .voices property
    const voicesArray = Array.isArray(voicesResponse) 
      ? voicesResponse 
      : (voicesResponse as any)?.voices || [];

    // Map voices to a simpler format - handle different possible property names
    const voicesList = voicesArray.map((voice: any) => {
      // Try multiple possible property names for voice ID
      // Based on ElevenLabs API, it should be 'voice_id' in snake_case
      const voiceId = voice.voice_id || voice.id || voice.voiceId || voice.voiceID || '';
      
      return {
        id: voiceId,
        name: voice.name || '',
        category: voice.category || 'unknown',
        description: voice.description || '',
      };
    }).filter(v => v.id); // Filter out voices without ID

    return NextResponse.json({ voices: voicesList });
  } catch (error) {
    console.error("Error fetching voices:", error);
    return NextResponse.json(
      { error: "Failed to fetch voices" },
      { status: 500 }
    );
  }
}
