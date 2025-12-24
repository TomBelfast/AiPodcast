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

    // Map voices to a simpler format - handle different possible property names
    const voicesList = voicesResponse.voices.map((voice: any) => ({
      id: voice.voice_id || (voice as any).id || '',
      name: voice.name || '',
      category: voice.category || 'unknown',
      description: voice.description || '',
    }));

    return NextResponse.json({ voices: voicesList });
  } catch (error) {
    console.error("Error fetching voices:", error);
    return NextResponse.json(
      { error: "Failed to fetch voices" },
      { status: 500 }
    );
  }
}
