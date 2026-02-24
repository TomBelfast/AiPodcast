'use server';

import { getElevenLabsClient, handleError, streamToBase64 } from '@/app/actions/utils';
import { CreateDialogueRequest, CharacterAlignment, Err, Ok, Result, VoiceSegment } from '@/types';

export async function createDialogue(
  request: CreateDialogueRequest
): Promise<Result<{
  audioBase64: string;
  processingTimeMs: number;
  voiceSegments?: VoiceSegment[];
  alignment?: CharacterAlignment;
  normalizedAlignment?: CharacterAlignment;
}>> {
  const startTime = performance.now();
  const clientResult = await getElevenLabsClient(request.apiKey);
  if (!clientResult.ok) return Err(clientResult.error);

  try {
    const client = clientResult.value;

    // Prepare the dialogue request according to the API specification
    const dialogueRequest = {
      inputs: request.inputs.map((input) => ({
        text: input.text,
        voiceId: input.voiceId,
      })),
      modelId: request.modelId || 'eleven_v3', // Switch back to v3 as per user request
      ...(request.seed && { seed: request.seed }),
    };

    let audioBase64: string;
    let voiceSegments: VoiceSegment[] | undefined;
    let alignment: CharacterAlignment | undefined;
    let normalizedAlignment: CharacterAlignment | undefined;

    if (request.includeTimestamps) {
      const response = await client.textToDialogue.convertWithTimestamps(dialogueRequest);
      audioBase64 = response.audioBase64;
      voiceSegments = response.voiceSegments;
      alignment = response.alignment;
      normalizedAlignment = response.normalizedAlignment;
    } else {
      const stream = await client.textToDialogue.convert(dialogueRequest);
      audioBase64 = await streamToBase64(stream);
    }

    const processingTimeMs = Math.round(performance.now() - startTime);

    return Ok({
      audioBase64: audioBase64.startsWith('data:') ? audioBase64 : `data:audio/mpeg;base64,${audioBase64}`,
      processingTimeMs,
      voiceSegments,
      alignment,
      normalizedAlignment,
    });
  } catch (error) {
    return handleError(error, 'dialogue generation');
  }
}