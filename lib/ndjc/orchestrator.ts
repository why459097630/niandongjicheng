/**
 * Minimal Orchestrator facade.
 * - Exports a named `orchestrate` (what route.ts imports)
 * - Keeps types small and avoids framework-specific deps
 * - Internally calls `callGroqChat` from ./groq
 */

import { callGroqChat, ChatMessage, ChatOpts } from "./groq";

export interface OrchestrateResult {
  /** Raw LLM text (unparsed) for precheck/validate stages */
  rawText: string;
  /** Optional parsed JSON if it looks like JSON */
  json?: unknown;
  /** Any quick local issues noticed while parsing */
  issues?: string[];
}

/**
 * Run one round of chat with Groq using prepared messages.
 * Return raw text and a best-effort parsed JSON (if applicable).
 */
export async function orchestrate(
  messages: ChatMessage[],
  opts: Partial<ChatOpts> = {}
): Promise<OrchestrateResult> {
  const { text } = await callGroqChat(messages, {
    temperature: 0,
    max_tokens: 2048,
    top_p: 1,
    ...opts,
  });

  const result: OrchestrateResult = { rawText: text, issues: [] };

  // Best-effort: if it looks like JSON, try to parse so the upper layer
  // (contract-precheck / validate) can consume it directly.
  const trimmed = text.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      result.json = JSON.parse(trimmed);
    } catch (e) {
      result.issues?.push(`JSON parse error: ${(e as Error).message}`);
    }
  }

  return result;
}

export default orchestrate;

// Re-export types to keep imports simple for callers
export type { ChatMessage, ChatOpts } from "./groq";
