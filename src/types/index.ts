export interface DialogueInput {
  text: string;
  voiceId: string;
}

export interface CreateDialogueRequest {
  inputs: DialogueInput[];
  modelId?: string;
  seed?: number;
  apiKey?: string;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export const Ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const Err = <T>(error: string): Result<T> => ({ ok: false, error });