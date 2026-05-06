import type {
  ConversationDraftItem,
  GeminiStyle,
  GeminiTempo,
  TtsProvider,
} from '@/lib/podcast/contracts';
import { normalizeConversationDraft } from '@/lib/podcast/contracts';

function getInternalAppBaseUrl(preferredBaseUrl?: string): string {
  const normalizedPreferred = String(preferredBaseUrl || '').trim();
  if (normalizedPreferred) {
    return normalizedPreferred.replace(/\/+$/, '');
  }

  return (
    process.env.INTERNAL_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://127.0.0.1:3300'
  )
    .trim()
    .replace(/\/+$/, '');
}

export async function parseConversationStream(
  response: Response
): Promise<ConversationDraftItem[]> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Generator conversation stream is unavailable.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finalConversation: ConversationDraftItem[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const parsed = JSON.parse(trimmed) as {
        type?: string;
        error?: string;
        data?: { conversation?: unknown };
      };

      if (parsed.type === 'error') {
        throw new Error(parsed.error || 'Conversation generation failed.');
      }

      if (parsed.type === 'complete') {
        finalConversation = normalizeConversationDraft(parsed.data?.conversation);
      }
    }
  }

  if (buffer.trim()) {
    const parsed = JSON.parse(buffer.trim()) as {
      type?: string;
      error?: string;
      data?: { conversation?: unknown };
    };

    if (parsed.type === 'error') {
      throw new Error(parsed.error || 'Conversation generation failed.');
    }

    if (parsed.type === 'complete') {
      finalConversation = normalizeConversationDraft(parsed.data?.conversation);
    }
  }

  return finalConversation;
}

export async function generateConversationDraft(args: {
  rawText: string;
  title: string;
  language: string;
  ttsProvider?: TtsProvider;
  geminiStyle?: GeminiStyle;
  geminiTempo?: GeminiTempo;
  internalAppBaseUrl?: string;
  timeoutMs?: number;
  llmAttemptTimeoutMs?: number;
}): Promise<ConversationDraftItem[]> {
  const response = await fetch(`${getInternalAppBaseUrl(args.internalAppBaseUrl)}/api/generate-podcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw_text: args.rawText,
      title: args.title,
      language: args.language,
      tts: {
        provider: args.ttsProvider || 'elevenlabs',
        geminiStyle: args.geminiStyle,
        geminiTempo: args.geminiTempo,
      },
      ...(args.llmAttemptTimeoutMs
        ? { timeout_ms: args.llmAttemptTimeoutMs }
        : {}),
    }),
    signal: AbortSignal.timeout(args.timeoutMs || 5 * 60 * 1000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Conversation generation failed: ${errorText.slice(0, 500)}`);
  }

  return parseConversationStream(response);
}
