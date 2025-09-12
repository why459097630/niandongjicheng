// niandongjicheng/lib/ndjc/providers/groq.ts
type ExtractedSpec = {
  appName: string;
  packageId: string;
  homeTitle: string;
  mainButtonText: string;
  permissionsXml?: string;
  intentFiltersXml?: string;
  themeOverridesXml?: string;
  localesEnabled?: boolean;
  localesList?: string;
  resConfigs?: string;
  proguardExtra?: string;
  packagingRules?: string;
};

const SYS_PROMPT_SPEC = `
你是“需求到配置”的提取器。读取用户自然语言，输出 JSON：
- 必填：appName, packageId, homeTitle, mainButtonText
- 可选：permissionsXml, intentFiltersXml, themeOverridesXml
- 可选：localesEnabled(boolean), localesList(逗号分隔), resConfigs(逗号分隔)
- 可选：proguardExtra(字符串), packagingRules(Gradle packaging{} 片段)
严格输出 JSON 对象。
`;

export async function groqExtractSpec(requirement: string): Promise<ExtractedSpec> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY 未配置');
  const model = process.env.NDJC_GROQ_MODEL || 'llama-3.1-70b-versatile';

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYS_PROMPT_SPEC },
        { role: 'user', content: requirement },
      ],
    }),
  });

  if (!r.ok) throw new Error(`Groq 调用失败 HTTP ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq 响应缺少 content');
  return JSON.parse(content);
}

// ============ 伴生代码（方案B专用，实验特性） ============
export type CompanionFile = { path: string; content: string; overwrite?: boolean };

const SYS_PROMPT_COMPANIONS = `
你将根据“需求+已确定的APP配置”产出少量伴生文件清单（JSON数组），仅用于 demo：
- 只能写入 app/companions/ 子目录（相对路径），例如：
  - "ui/Welcome.kt"（或 .xml / .json / .txt）
  - "assets/readme.txt"
- 文件数量尽量少（<= 5），体量控制在几百行以内
- 注意：不要修改工程现有文件，只能写 companions 子目录
- 字段：{ "path": "相对路径", "content": "文件内容", "overwrite": false }
严格输出 JSON 数组，不要多余文本。
`;

export async function groqGenerateCompanions(
  requirement: string,
  spec: ExtractedSpec
): Promise<CompanionFile[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY 未配置');
  const model = process.env.NDJC_GROQ_MODEL || 'llama-3.1-70b-versatile';

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' }, // 有些模型对 array 也要求包一层
      messages: [
        { role: 'system', content: SYS_PROMPT_COMPANIONS },
        {
          role: 'user',
          content:
            `需求：\n${requirement}\n\n` +
            `已确定配置(JSON)：\n${JSON.stringify(spec, null, 2)}\n\n` +
            `请只输出 JSON 数组：[{ path, content, overwrite }]`,
        },
      ],
    }),
  });

  if (!r.ok) throw new Error(`Groq 调用失败 HTTP ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq 响应缺少 content');

  let arr: any;
  try {
    // 允许模型把数组包到 {files:[...]} 或直接返回 [...]:
    const parsed = JSON.parse(content);
    arr = Array.isArray(parsed) ? parsed : parsed?.files ?? [];
  } catch {
    throw new Error('Groq 返回非 JSON：' + content.slice(0, 200));
  }

  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => ({
      path: String(x.path ?? ''),
      content: String(x.content ?? ''),
      overwrite: !!x.overwrite,
    }))
    .filter((x) => x.path && x.content);
}
