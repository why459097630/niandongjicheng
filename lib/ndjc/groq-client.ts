// lib/ndjc/groq-client.ts
const GROQ_API_KEY = process.env.GROQ_API_KEY!;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-70b-versatile";
const URL = "https://api.groq.com/openai/v1/chat/completions";

export type GroqPlan = {
  appName: string;
  packageName: string;
  files: Array<
    | { path: string; mode: "patch"; patches: { anchor: string; insert: string }[] }
    | { path: string; mode: "replace" | "create"; content?: string; contentBase64?: string }
  >;
  manifestPatches?: any[];
  gradlePatches?: any[];
  assets?: any[];
};

// —— 系统提示：明确禁止改动/新增 app_name —— //
const SYSTEM_PROMPT = `
你是“NDJC 代码生成器”。只输出严格 JSON（json_object），不要解释。
目标：基于安卓原生模板进行“锚点注入”，不要生成完整工程。
允许的 mode: patch | replace | create
锚点示例：NDJC:IMPORTS / NDJC:ONCREATE / NDJC:FUNCTIONS / NDJC:VIEWS / NDJC:STRINGS

【重要约束】
- 绝不要在 values/strings.xml 中新增或修改 key "app_name"（模板已有该键，重复会导致 aapt2 失败）。
- 如需新增字符串资源，请使用自定义 key（如 "ndjc_title"）；或直接在布局里使用硬编码文本。
`.trim();

function coerceJson(text: string) {
  const m = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const raw = m ? m[1] : text;
  return JSON.parse(raw);
}

function validatePlan(x: any): x is GroqPlan {
  if (!x || typeof x !== "object") return false;
  if (typeof x.appName !== "string") return false;
  if (typeof x.packageName !== "string") return false;
  if (!Array.isArray(x.files)) return false;
  for (const f of x.files) {
    if (typeof f?.path !== "string") return false;
    if (!["patch", "replace", "create"].includes(f.mode)) return false;
    if (f.mode === "patch") {
      if (!Array.isArray((f as any).patches)) return false;
      for (const p of (f as any).patches) {
        if (typeof p?.anchor !== "string" || typeof p?.insert !== "string") return false;
      }
    }
  }
  return true;
}

export async function callGroqToPlan(input: {
  prompt: string;
  appName: string;
  packageName: string;
  anchorsHint?: string[];
}): Promise<GroqPlan> {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is missing");

  const user = `
需求：${input.prompt}
目标包名：${input.packageName}
应用名：${input.appName}
现有锚点：${(input.anchorsHint || [
    "NDJC:IMPORTS",
    "NDJC:ONCREATE",
    "NDJC:FUNCTIONS",
    "NDJC:VIEWS",
    "NDJC:STRINGS",
  ]).join(", ")}。
`.trim();

  const res = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Groq API failed: ${res.status} ${res.statusText} ${t}`);
  }

  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content || "";
  const json = coerceJson(text);

  if (!validatePlan(json)) throw new Error("Groq returned invalid plan JSON");
  return json;
}
