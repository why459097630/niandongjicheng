// /app/api/build/route.ts
// 完整版（Next.js App Router）
// 功能：
// 1) 用 OpenAI 生成结构化内容（Lamborghini 车型目录，含图片 URL）
// 2) 将 catalog.json 提交到仓库 android-app/src/main/assets/catalog.json
// 3) 可选：触发 GitHub Actions 工作流（如 android-build-matrix.yml）进行打包

import type { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { Octokit } from '@octokit/rest';

export const dynamic = 'force-dynamic'; // 保证每次请求都执行
export const runtime = 'nodejs';

/* -----------------------------
   工具：提交/更新仓库文件
------------------------------*/
async function upsertFile(params: {
  owner: string;
  repo: string;
  branch: string;
  path: string;     // 如 'android-app/src/main/assets/catalog.json'
  content: string;  // 纯文本（会自动转 base64）
  message: string;
  token: string;
}) {
  const { owner, repo, branch, path, content, message, token } = params;
  const octokit = new Octokit({ auth: token });

  // 获取现有文件的 sha（如果存在）
  let sha: string | undefined;
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    if (!Array.isArray(data)) sha = (data as any).sha;
  } catch (err: any) {
    if (err?.status !== 404) {
      throw err;
    }
  }

  const resp = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    branch,
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    sha,
  });

  // 返回提交后的信息（commit sha 等）
  return {
    commitSha: (resp?.data?.commit?.sha as string) || '',
    htmlUrl: (resp?.data?.content as any)?.html_url || '',
  };
}

/* -----------------------------
   工具：可选触发 workflow_dispatch
------------------------------*/
async function triggerWorkflow(params: {
  owner: string;
  repo: string;
  branch: string;
  workflowFile: string; // 例如：'android-build-matrix.yml'
  token: string;
  inputs?: Record<string, string>;
}) {
  const { owner, repo, branch, workflowFile, token, inputs } = params;
  const octokit = new Octokit({ auth: token });

  await octokit.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: workflowFile,
    ref: branch,
    inputs,
  });
}

const CONTENT_PATH = process.env.CONTENT_PATH || 'android-app/src/main/assets/catalog.json';

const SCHEMA_HINT = `
Return ONLY valid JSON, matching this schema:

{
  "appTitle": string,
  "intro": string,
  "models": [
    {
      "name": string,
      "year": string,
      "description": string,
      "imageUrl": string
    }
  ]
}
`;

/* -----------------------------
   API 入口
------------------------------*/
export async function POST(req: NextRequest) {
  try {
    // 读取请求体
    const { prompt, template = 'simple-template', smart = true } = await req.json();

    // 基础校验
    const owner = process.env.OWNER!;
    const repo = process.env.REPO!;
    const branch = process.env.REF || 'main';
    const token = process.env.GITHUB_TOKEN!;
    const openaiKey = process.env.OPENAI_API_KEY!;
    const workflowFile = process.env.WORKFLOW_FILE; // 可选

    if (!openaiKey) {
      return new Response(JSON.stringify({ ok: false, error: 'MISSING_OPENAI_API_KEY' }), { status: 500 });
    }
    if (!token || !owner || !repo) {
      return new Response(JSON.stringify({ ok: false, error: 'MISSING_GITHUB_CONFIG' }), { status: 500 });
    }

    const runId = Date.now().toString(); // 用于标识这次构建

    /* 1) 调用 OpenAI 生成结构化内容 */
    const openai = new OpenAI({ apiKey: openaiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: smart ? 0.7 : 0.2,
      messages: [
        {
          role: 'system',
          content: `You are a professional content engineer. ${SCHEMA_HINT}`,
        },
        {
          role: 'user',
          content: `
Create a complete catalog for an Android app "${prompt}".
- The app introduces ALL significant Lamborghini models throughout history.
- Each model must include a public imageUrl (reachable on internet), a concise year range, and a 2–4 sentence description.
- Keep JSON valid and compact.
          `.trim(),
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? '{}';
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'BAD_JSON_FROM_AI', raw }), { status: 502 });
    }

    // 附加一些元信息（可选）
    parsed.generatedAt = new Date().toISOString();
    parsed.template = template;
    const json = JSON.stringify(parsed, null, 2);

    /* 2) 提交/更新到仓库 assets */
    const commitMessage = `feat(content): update catalog.json (${prompt}) [run:${runId}]`;
    const upsert = await upsertFile({
      owner,
      repo,
      branch,
      path: CONTENT_PATH,
      content: json,
      message: commitMessage,
      token,
    });

    /* 3) 可选：触发 workflow 打包（如果你把 workflow 配置为 on: workflow_dispatch）*/
    if (workflowFile) {
      await triggerWorkflow({
        owner,
        repo,
        branch,
        workflowFile,
        token,
        inputs: { runId }, // 你的 workflow 如需 runId 可自行读取
      });
    }

    // 返回结果给前端
    return new Response(
      JSON.stringify({
        ok: true,
        message: 'Content committed to repository successfully.',
        path: CONTENT_PATH,
        commitSha: upsert.commitSha,
        runId,
        workflowDispatched: Boolean(workflowFile),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('POST /api/build error:', err);
    return new Response(JSON.stringify({ ok: false, error: 'INTERNAL_ERROR', detail: String(err?.message || err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
