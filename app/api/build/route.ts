import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers || {}),
    },
  });
}

// 可选：如果你前端/后端分域名（Vercel 两个项目）才需要 CORS。
// 同域（同一个 Next 项目里 page 调 api）不需要，但加上也不碍事。
function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";

    // 兼容 JSON / FormData 两种提交
    let payload: any = {};
    if (contentType.includes("application/json")) {
      payload = await req.json();
    } else if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      // 你前端怎么传，这里就怎么取；先做最大兼容：
      payload.appName = String(form.get("appName") || "");
      payload.mode = String(form.get("mode") || "");
      payload.modules = JSON.parse(String(form.get("modules") || "[]"));
      payload.uiPacks = JSON.parse(String(form.get("uiPacks") || "[]"));

      const icon = form.get("icon");
      if (icon && icon instanceof File) {
        // 不直接在这里处理图片：交给后端/Packaging-warehouse
        // 这里先把 meta 带上，后续你要我再把“上传到后端/写入模板”接完整
        payload.icon = {
          name: icon.name,
          type: icon.type,
          size: icon.size,
        };
      }
    } else {
      // 兜底：尝试按 json 读
      try {
        payload = await req.json();
      } catch {
        payload = {};
      }
    }

    // 基础字段容错：不改变你现有前端结构，只做更稳的兜底
    const appName = (payload.appName || payload.name || "NDJC App").toString().trim();
    const modules = Array.isArray(payload.modules) ? payload.modules : [];
    const uiPacks = Array.isArray(payload.uiPacks) ? payload.uiPacks : [];

    // 这里先返回 runId，确保前端“触发构建”不会再 405
    // 下一步再把这里接到 Packaging-warehouse（写 assembly.local.json + 触发 workflow）
    const runId = payload.runId || `ndjc-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;

    const resp = json({
      ok: true,
      runId,
      appName,
      modules,
      uiPacks,
      message: "API /api/build is alive (POST ok). Next: wire to Packaging-warehouse workflow.",
    });

    return withCors(resp);
  } catch (e: any) {
    const resp = json(
      {
        ok: false,
        error: e?.message || String(e),
      },
      { status: 500 }
    );
    return withCors(resp);
  }
}
