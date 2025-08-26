// lib/ndjc/groq-client.ts
const GROQ_API_KEY = process.env.GROQ_API_KEY!;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-70b-versatile";
const URL = "https://api.groq.com/openai/v1/chat/completions";

/** —— JSON 中间表示（Spec）Schema —— */
export type NdjcSpec = {
  appName: string;           // 展示名（不改 strings.xml 的 app_name）
  packageName: string;       // 包名（当前版本不自动迁移包路径）
  ui?: {
    /** 直接插到 NDJC:VIEWS（必须是合法的子节点集合，不要额外包一层根） */
    viewsXml?: string;
  };
  logic?: {
    /** 逐行插到 NDJC:ONCREATE */
    onCreate?: string[];
    /** 追加到 NDJC:FUNCTIONS（每个元素是一个完整 Java 方法） */
    functions?: string[];
    /** 追加到 NDJC:IMPORTS（可选，谨慎使用以避免重复） */
    imports?: string[];
  };
  /** 插到 NDJC:STRINGS；禁止 name=app_name */
  strings?: { name: string; value: string }[];
  gradle?: {
    /** 插到 NDJC:DEPS（形如 implementation 'xxx:yyy:1.0.0'） */
    dependencies?: string[];
  };
  manifest?: {
    /** 插到 NDJC:MANIFEST（<application> 内部片段） */
    applicationAdditions?: string;
  };
  /** 生成静态资源（如 assets/json） */
  assets?: {
    path: string;            // 相对仓库根路径
    content?: string;        // 文本
    contentBase64?: string;  // 或 base64（二者择一）
  }[];
};

const SYSTEM_PROMPT = `
你是“NDJC 代码规划器”。只输出**严格 JSON**（不要 Markdown 代码块），遵循下列 Schema：

{
  "appName": "string",
  "packageName": "string",
  "ui": { "viewsXml": "Android XML 片段，必须是当前布局容器的若干子节点，不要再包外层布局" },
  "logic": {
    "onCreate": ["Java 单行语句（结尾可分号）"],
    "functions": ["完整 Java 方法（含签名与花括号）"],
    "imports": ["import android.widget.Button;"]
  },
  "strings": [{"name":"ndjc_title","value":"xxx"}],  // 禁止 app_name
  "gradle": { "dependencies": ["implementation 'com.squareup.okhttp3:okhttp:4.12.0'"] },
  "manifest": { "applicationAdditions": "<provider .../> 或 <meta-data .../>" },
  "assets": [{"path":"app/src/main/assets/generated/spec.json","content":"{...}"}]
}

硬性约束：
- 绝不要在 values/strings.xml 里新增或修改 "app_name"。
- Java 片段优先使用内联强转：((android.widget.Button) findViewById(R.id.btn...))
- XML 片段必须是**有效子节点集合**，不能带多余 <LinearLayout> 包裹。
- 输出必须是纯 JSON（不能有注释、不能被 \`\`\` 包裹）。
`.trim();

function parseJson(text: string) {
  // 某些模型会外包 ```json ... ```；剥离
  const m = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = m ? m[1] : text;
  return JSON.parse(raw);
}

function validate(spec: any): spec is NdjcSpec {
  return !!(spec && typeof spec === "object" && typeof spec.appName === "string" && typeof spec.packageName === "string");
}

export async function callGroqToSpec(params: {
  prompt: string;
  appName: string;
  packageName: string;
}): Promise<NdjcSpec> {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is missing");

  const user = `
需求：${params.prompt}
应用名：${params.appName}
包名：${params.packageName}
请严格按系统提示的 Schema 输出纯 JSON。
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
  const json = parseJson(text);
  if (!validate(json)) throw new Error("Groq returned invalid spec JSON");
  return json;
}
