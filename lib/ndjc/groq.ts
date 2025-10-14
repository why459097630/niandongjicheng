// lib/ndjc/groq.ts
import type { RequestInit } from "node-fetch";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatOpts = {
  model?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  json?: boolean; // 仅作提示，不强制 SDK 设置 JSON mode，避免原文丢失
  headers?: Record<string, string>;
  timeout_ms?: number;
};

export type ChatResult = {
  ok: boolean;
  text: string;            // 模型主输出（合并）
  raw: any;                // 完整响应 JSON
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: string;
};

const DEFAULT_MODEL = process.env.NDJC_MODEL || "llama-3.1-8b-instant";
const API_URL = process.env.GROQ_API_URL || "https://api.groq.com/openai/v1/chat/completions";
const API_KEY = process.env.GROQ_API_KEY || process.env.GROQ_API_TOKEN || "";

function withTimeout<T>(p: Promise<T>, ms = 60000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`groqChat timeout after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch((e) => { clearTimeout(t); reject(e); });
  });
}

export async function groqChat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<ChatResult> {
  if (!API_KEY) {
    return { ok: false, text: "", raw: null, error: "GROQ_API_KEY missing" };
  }

  const body = {
    model: opts.model || DEFAULT_MODEL,
    temperature: opts.temperature ?? 0,
    top_p: opts.top_p ?? 1,
    max_tokens: opts.max_tokens ?? 1024,
    stream: false,
    messages,
  };

  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
      ...(opts.headers || {}),
    },
    body: JSON.stringify(body),
  };

  try {
    const res = await withTimeout(fetch(API_URL, init as any), opts.timeout_ms || 60000);
    const raw = await res.json().catch(() => null);
    if (!res.ok) {
      const message = raw?.error?.message || `HTTP ${res.status}`;
      return { ok: false, text: String(message || ""), raw, error: message };
    }

    // openai-compatible schema
    const choices = raw?.choices || [];
    const text = choices.map((c: any) => c?.message?.content || "").join("");

    return {
      ok: true,
      text: typeof text === "string" ? text : "",
      raw,
      usage: raw?.usage,
    };
  } catch (e: any) {
    const msg = e?.message || String(e);
    // 仍返回可读 text，避免上层出现 “No raw LLM text”
    return { ok: false, text: `/* groqChat error: ${msg} */`, raw: null, error: msg };
  }
}
