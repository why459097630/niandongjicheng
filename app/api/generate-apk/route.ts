import { NextRequest, NextResponse } from "next/server";
import { writeToRepo } from "@/lib/gh";
import { runGenerator } from "@/lib/ndjc/generator";

const OWNER = process.env.GH_OWNER || "why459097630";
const REPO  = process.env.GH_REPO  || "Packaging-warehouse";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { prompt = "", template = "core", features = [] } = body as {
    prompt: string;
    template: "simple" | "core" | "form";
    features: string[];
  };

  const buildId = `${Date.now()}`;
  const reqDir  = `requests/${buildId}`;

  // 1) 调用 LLM（这里用占位，你接上真实模型即可）
  const raw = await callLLM(prompt, template, features);

  // 2) 编排器：强校验 → 统一契约
  const normalized = normalize(raw, { prompt, template, features });

  // 3) 先把可观测数据落盘（即使后续失败也能审计）
  await writeText(`${reqDir}/prompt.txt`, `${prompt}\n`, `NDJC: save prompt (${buildId})`);
  await writeJson(`${reqDir}/raw.json`, raw, `NDJC: save raw LLM (${buildId})`);
  await writeJson(`${reqDir}/normalized.json`, normalized, `NDJC: save normalized (${buildId})`);

  // 4) 生成器：根据 normalized + features 注入锚点
  const { injectedAnchors, filesTouched } = await runGenerator({
    buildId, normalized, owner: OWNER, repo: REPO,
  });

  // 5) 报告
  const report = {
    ok: true,
    buildId,
    prompt,
    template,
    requestedAnchors: features,
    injectedAnchors,
    skippedAnchors: features.filter(a => !injectedAnchors.includes(a)),
    filesTouched,
    createdAt: new Date().toISOString(),
  };
  await writeJson(`${reqDir}/report.json`, report, `NDJC: save report (${buildId})`);

  // 6) 触发你现有的 GitHub Actions（如果是用 push 即已触发；否则在这里加 dispatch）
  // 这里不做额外触发，保持你当前流程

  return NextResponse.json({ ok: true, buildId, message: "已保存请求并触发构建" });

  // helpers
  async function writeText(path: string, content: string, msg: string) {
    await writeToRepo({ owner: OWNER, repo: REPO, filePath: path, content, message: msg });
  }
  async function writeJson(path: string, obj: any, msg: string) {
    await writeText(path, JSON.stringify(obj, null, 2), msg);
  }
}

// ====== 占位的 LLM 与编排器 ======
async function callLLM(prompt: string, template: string, features: string[]) {
  // TODO: 接入你正在使用的 LLM（Groq/OpenAI 等）
  return {
    spec: {
      pages: [{ id: "home", components: [{ type: "text", text: prompt || "示例" }] }],
    },
    features,
  };
}

function normalize(raw: any, ctx: { prompt: string; template: string; features: string[] }) {
  // TODO: 这里做强校验（packageName合法、pages>=1、components>=1、SDK）
  return {
    meta: { appName: "My App", packageName: "com.ndjc.app" },
    template: (ctx.template || "core") as "simple" | "core" | "form",
    ui: raw?.spec || { pages: [] },
    features: Array.isArray(ctx.features) ? ctx.features : [],
    build: { minSdk: 24, targetSdk: 34 },
  };
}
