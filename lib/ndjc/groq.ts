/**
 * Thin Groq Chat API wrapper used by the NDJC orchestrator.
 * - No streaming (keeps types simple and matches how route.ts calls it)
 * - Exposes a single `callGroqChat` function + types
 * - Reads GROQ_API_KEY and optional GROQ_MODEL from env
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOpts {
  /** 0–2 */
  temperature?: number;
  /** max tokens for the assistant output */
  max_tokens?: number;
  /** 0–1 */
  top_p?: number;
  /** override model name if needed */
  model?: string;
}

export interface ChatResponse<TRaw = unknown> {
  /** assistant text content */
  text: string;
  /** raw API payload for diagnostics */
  raw: TRaw;
}

/**
 * Call Groq's OpenAI-compatible chat completions endpoint.
 * Returns `{ text, raw }`.
 */
export async function callGroqChat(
  messages: ChatMessage[],
  opts: Partial<ChatOpts> = {}
): Promise<ChatResponse> {
  const apiKey =
    process.env.GROQ_API_KEY ?? process.env.NEXT_PUBLIC_GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY not found (set GROQ_API_KEY or NEXT_PUBLIC_GROQ_API_KEY)"
    );
  }

  const model = opts.model ?? process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";

  // Keep body schema aligned with OpenAI-compatible API
  const body = {
    model,
    messages,
    temperature: opts.temperature ?? 0,
    max_tokens: opts.max_tokens ?? 2048,
    top_p: opts.top_p ?? 1,
  };

  const res = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Groq API error: ${res.status} ${res.statusText} ${errText}`
    );
  }

  const data = await res.json();
  const text: string =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.delta?.content ??
    "";

  return { text, raw: data };
}

export default callGroqChat;
