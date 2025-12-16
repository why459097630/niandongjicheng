// app/api/build/route.ts

import { NextRequest, NextResponse } from "next/server";

// ====== 生成唯一的 Run ID ======
function utcRunId(prefix = "ndjc") {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts =
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z";
  return `${prefix}-${ts}`;
}

// ====== API 路由处理 ======
export async function POST(req: NextRequest) {
  try {
    // 解析请求体
    const body = await req.json();
    const { run_id, template_key, appName, iconPrompt, uiPack, modules } = body;

    // 触发构建逻辑
    const buildResult = await triggerBuild({
      runId: run_id || utcRunId(),
      template_key,
      appName,
      iconPrompt,
      uiPack,
      modules,
    });

    // 返回构建结果
    return NextResponse.json({ ok: true, runId: run_id, ...buildResult });
  } catch (error) {
    // 错误处理
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

// ====== 模拟触发构建的函数 ======
async function triggerBuild({
  runId,
  appName,
  iconPrompt,
  uiPack,
  modules,
  template_key,
}: {
  runId: string;
  appName: string;
  iconPrompt: string;
  uiPack: string;
  modules: string[];
  template_key: string;
}) {
  // 在此处处理实际的构建逻辑，例如触发 GitHub Actions 或其他服务进行 APK 构建
  // 这里模拟了一个构建过程
  try {
    // 模拟 API 调用，实际可能是触发 CI/CD、构建任务等
    console.log(`Starting build for ${appName} with template ${template_key}...`);

    // 假设调用了外部构建系统，这里直接返回构建状态
    return {
      actionsUrl: `https://github.com/your-repo/actions/workflows/build-${runId}.yml`, // GitHub Actions URL
      status: "queued", // 构建状态：queued、running、success、failure等
      artifactUrl: "https://example.com/download/artifact", // 构建产物下载 URL（可选）
    };
  } catch (error) {
    throw new Error("Build process failed: " + error.message);
  }
}

// ====== CORS 设置（如果前端和后端在不同域） ======
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// 处理 OPTIONS 请求，用于跨域预检
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
