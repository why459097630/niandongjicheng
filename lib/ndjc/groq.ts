// lib/ndjc/groq.ts
/**
 * Groq chat via native fetch (no groq-sdk dependency).
 * Keep the same signature used by orchestrator:
 *   groqChat(messages, { json?, temperature?, top_p?, max_tokens?, model? })
 *
 * Requirements:
 *   - Set GROQ_API_KEY in environment variables
 *   - (optional) NDJC_GROQ_MODEL for default model override
 */

const API_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOpts = {
  /** Ask the model to return valid JSON (OpenAI-compatible response_format) */
  json?: boolean;
  /** 0 ~ 2 typically; default 0 */
  temperature?: number;
  /** 0 ~ 1; default 1 */
  top_p?: number;
  /** max tokens for completion; default 1024 */
  max_tokens?: number;
  /** override model name; default from env or "llama-3.1-8b-instant" */
  model?: string;
  /** optional request timeout in ms; default 60_000 */
  timeoutMs?: number;
};

function ensureEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

function buildBody(messages: ChatMessage[], opts: ChatOpts) {
  return {
    model:
      opts.model ||
      process.env.NDJC_GROQ_MODEL ||
      "llama-3.1-8b-instant",
    temperature: opts.temperature ?? 0,
    top_p: opts.top_p ?? 1,
    max_tokens: opts.max_tokens ?? 1024,
    // OpenAI-compatible "response_format" for JSON forcing:
    response_format: opts.json ? { type: "json_object" } : undefined,
    messages,
  };
}

async function doFetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Call Groq chat completions via fetch.
 * Returns the first choice message.content (string; may be JSON-encoded text if json=true).
 */
export async function groqChat(
  messages: ChatMessage[],
  opts: ChatOpts = {}
): Promise<string> {
  const apiKey = ensureEnv("GROQ_API_KEY");

  // Basic validation to avoid silly 400s
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("groqChat: 'messages' must be a non-empty array.");
  }

  const body = buildBody(messages, opts);

  const res = await doFetchWithTimeout(
    API_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    opts.timeoutMs ?? 60_000
  );

  // Handle HTTP error with detailed text for debugging
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const hint =
      text && text.length > 500 ? text.slice(0, 500) + "…" : text;
    throw new Error(
      `groqChat HTTP ${res.status} ${res.statusText} - ${hint || "no body"}`
    );
  }

  const data = await res.json().catch((e) => {
    throw new Error(`groqChat: invalid JSON response: ${String(e)}`);
  });

  // OpenAI-compatible response shape:
  // { choices: [{ message: { role, content } }] }
  const content =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.delta?.content ?? // (stream fragments, just in case)
    "";

  if (typeof content !== "string") {
    // Make it explicit: downstream expects string
    return JSON.stringify(content);
  }

  return content;
}

export default groqChat;
