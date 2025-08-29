// /app/api/generate-apk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generateWithAudit } from "@/lib/ndjc/generator";

/**
 * 接收前端的 prompt/template/features，
 * 1) 调用你的 LLM（此处先用占位 raw）
 * 2) 生成 normalized 契约
 * 3) 调用 generateWithAudit：
 *    - 写入 Packaging-warehouse/requests/<buildId> 下的审计文件
 *    - 生成模板文件/锚点占位并推送
 *    - 触发 GitHub Actions 打包
 * 4) 返回 buildId / injectedAnchors
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    prompt = "",
    template = "core",
    features = [],
    params = {}, // 可选：允许前端覆盖部分 NDJC_* 锚点参数
  } = body as {
    prompt: string;
    template: "simple" | "core" | "form";
    features: string[];
    params?: Record<string, any>;
  };

  // TODO：接入你真实的 LLM，这里先放占位 raw，确保链路能跑通
  const raw = {
    spec: {
      pages: [{ id: "home", components: [{ type: "text", text: prompt || "示例" }] }],
    },
  };

  const normalized = {
    template,
    features: Array.isArray(features) ? features : [],
    params: {
      NDJC_APP_NAME: "My App",
      // 允许从 body.params 覆盖默认锚点（如 NDJC_PACKAGE_ID / NDJC_PRIMARY_COLOR 等）
      ...(params || {}),
    },
  } as const;

  const { ok, buildId, injectedAnchors } = await generateWithAudit({
    prompt,
    raw,
    normalized,
  });

  return NextResponse.json({
    ok,
    buildId,
    injectedAnchors,
    message: "已保存请求并触发构建",
  });
}
