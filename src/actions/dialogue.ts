'use server';

import { handleError } from '@/app/actions/utils';
import { CreateDialogueRequest, CharacterAlignment, Err, Ok, Result, VoiceSegment } from '@/types';

export async function createDialogue(
  request: CreateDialogueRequest
): Promise<Result<{
  audioBase64: string;
  processingTimeMs: number;
  charactersUsed?: number;
  voiceSegments?: VoiceSegment[];
  alignment?: CharacterAlignment;
  normalizedAlignment?: CharacterAlignment;
}>> {
  const startTime = performance.now();
  const apiKey = request.apiKey || process.env.ELEVENLABS_API_KEY;
  
  if (!apiKey) {
    return Err("ElevenLabs API key is missing.");
  }

  try {
    // Prepare the dialogue request according to the API specification
    const dialogueRequest = {
      inputs: request.inputs.map((input) => ({
        text: input.text,
        voice_id: input.voiceId,
      })),
      model_id: request.modelId || 'eleven_v3',
      ...(request.seed && { seed: request.seed }),
    };

    const endpoint = request.includeTimestamps 
      ? "https://api.elevenlabs.io/v1/text-to-dialogue/with-timestamps"
      : "https://api.elevenlabs.io/v1/text-to-dialogue";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(dialogueRequest)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return Err(`ElevenLabs API error: ${response.status} ${JSON.stringify(errorData)}`);
    }

    const charactersUsed = parseInt(response.headers.get("x-character-count") || "0", 10);
    const processingTimeMs = Math.round(performance.now() - startTime);

    if (request.includeTimestamps) {
      const data = await response.json();
      return Ok({
        audioBase64: data.audio_base64.startsWith('data:') ? data.audio_base64 : `data:audio/mpeg;base64,${data.audio_base64}`,
        processingTimeMs,
        charactersUsed,
        voiceSegments: data.voice_segments,
        alignment: data.alignment,
        normalizedAlignment: data.normalized_alignment,
      });
    } else {
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const audioBase64 = buffer.toString('base64');
      
      return Ok({
        audioBase64: `data:audio/mpeg;base64,${audioBase64}`,
        processingTimeMs,
        charactersUsed,
      });
    }
  } catch (error: unknown) {
    return handleError(error, 'dialogue generation');
  }
}
