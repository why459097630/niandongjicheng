// app/api/probe-capability/route.ts
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";

export const runtime = "nodejs";

// 仅保留“可以/不可以”
function normalizeYesNo(s: string): "可以" | "不可以" | null {
  const t = (s || "").trim();
  if (t === "可以") return "可以";
  if (t === "不可以") return "不可以";
  // 容错：截断到第一个词
  if (t.startsWith("可以")) return "可以";
  if (t.startsWith("不可以")) return "不可以";
  return null;
}

function toBulletText(input: string | string[] | undefined): string {
  if (!input) return "";
  if (Array.isArray(input)) {
    return input.map((x) => `• ${String(x || "").trim()}`).join("\n");
  }
  return String(input).trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const constraints = body?.constraints as string | string[] | undefined;

    if (!constraints || (Array.isArray(constraints) && constraints.length === 0)) {
      return Response.json(
        { ok: false, error: "constraints is required (string or string[])" },
        { status: 400 }
      );
    }

    const userText = toBulletText(constraints).slice(0, 4000); // 简单限长，避免超长提示

    const systemText =
      '你将收到一组构建约束。请判断是否能在一次生成中完全满足这些约束。\n' +
      '只能返回 JSON：{"answer":"可以"} 或 {"answer":"不可以"}。不要解释，不要附加任何其他内容。';

    const messages = [
      { role: "system" as const, content: systemText },
      { role: "user" as const, content: userText },
    ];

    console.log(
      "[probe] yes/no run start (temp=0 top_p=0 max_tokens~8) constraints_len=%d",
      userText.length
    );

    // 复用现有 groq 封装；json: true 便于模型以 JSON 形式返回
    const r = await callGroqChat(messages, {
      temperature: 0,
      top_p: 0,
      max_tokens: 8,
      json: true,
    });

    const text = typeof r === "string" ? r : (r as any)?.text ?? "";
    let answer: "可以" | "不可以" | null = null;

    // 1) 尝试 JSON 解析 {"answer":"可以"} / {"answer":"不可以"}
    try {
      const parsed = JSON.parse(text);
      const a = parsed?.answer;
      if (a === "可以" || a === "不可以") {
        answer = a;
      }
    } catch {
      /* ignore */
    }

    // 2) 非 JSON，则从纯文本里提取首个 可以/不可以
    if (!answer) {
      answer = normalizeYesNo(text);
    }

    // 3) 都失败则保守判“不可以”
    if (!answer) {
      answer = "不可以";
    }

    console.log("[probe] yes/no answer=%s", answer);

    return Response.json({
      ok: true,
      answer,
      used_prompt: "inline-zh:yes/no-json",
      constraints_preview: userText.slice(0, 120),
    });
  } catch (e: any) {
    console.error("[probe] error:", e?.message || e);
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
