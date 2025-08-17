// /app/api/build/route.ts
import { NextResponse } from 'next/server';
import OpenAI from 'openai';

type BuildRequest = {
  prompt: string;
  template?: string; // 'simple-template' | 'xxx'
  smart?: boolean;   // 是否启用 AI 文案生成
};

function makeClient() {
  const provider = (process.env.LLM_PROVIDER || 'openai').toLowerCase();

  let apiKey = '';
  let baseURL = '';
  let defaultModel = process.env.MODEL || '';

  if (provider === 'deepseek') {
    apiKey = process.env.DEEPSEEK_API_KEY || '';
    baseURL = 'https://api.deepseek.com';
    defaultModel ||= 'deepseek-chat';
  } else if (provider === 'groq') {
    apiKey = process.env.GROQ_API_KEY || '';
    baseURL = 'https://api.groq.com/openai/v1';
    defaultModel ||= 'llama3-70b-8192';
  } else {
    // openai 官方
    apiKey = process.env.OPENAI_API_KEY || '';
    baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    defaultModel ||= process.env.OPENAI_MODEL || 'gpt-4o-mini'; // 或 gpt-4o / gpt-3.5 之类
  }

  if (!apiKey) throw new Error(`Missing API key for provider=${provider}`);

  const client = new OpenAI({ apiKey, baseURL });
  return { client, model: defaultModel, provider };
}

async function aiGenerateCopy(input: string) {
  const { client, model, provider } = makeClient();

  // 统一用 Chat Completions
  const system = 'You are an assistant that writes concise, well-structured app descriptions and content in English.';

  const r = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: input },
    ],
    temperature: 0.7,
  });

  const text =
    r.choices?.[0]?.message?.content?.toString().trim() ||
    '';
  return { text, provider, model };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as BuildRequest;

    // 1) 参数校验
    if (!body?.prompt || typeof body.prompt !== 'string') {
      return NextResponse.json({ ok: false, error: 'BAD_REQUEST' }, { status: 400 });
    }

    // 2) 如果 smart=true，则调模型生成文案；否则用原始 prompt
    let finalPrompt = body.prompt;
    let aiUsed: null | { provider: string; model: string } = null;

    if (body.smart) {
      const { text, provider, model } = await aiGenerateCopy(
        `Generate detailed app content based on this instruction: "${body.prompt}". 
         Write structured sections: overview, key features, data sources (if any), and suggested UI text.
         Keep it concise and ready to insert into an Android app's resources.`
      );
      if (text) {
        finalPrompt = text;
        aiUsed = { provider, model };
      }
    }

    // 3) 这里是你现有的“生成仓库内容并 push 到 GitHub”的逻辑
    //    把 finalPrompt 写入模板里的某个 JSON/TS 文件，让后续构建把它打包进 app。
    //    例如：生成 /android-app/app_content.json 之类，并提交到 GitHub。
    //
    //    下面只是示意，替换为你现有的 push-to-github 代码：
    // await writeAndPushToRepo({ promptText: finalPrompt, template: body.template || 'simple-template' });

    // 4) 返回 runId/commitSha（你已有）
    return NextResponse.json({
      ok: true,
      smart: !!body.smart,
      used: aiUsed,
      // commitSha: 'xxxxxx', // 你真实的commit
    });
  } catch (err: any) {
    console.error('[api/build] error:', err);
    const msg = err?.message || 'INTERNAL_ERROR';
    // 将常见错误（缺key/401/配额）反馈给前端
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
