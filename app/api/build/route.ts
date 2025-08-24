// app/api/build/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";

export const runtime = "nodejs"; // 不能是 edge，需 Node 能力

// —— 环境变量兼容：优先用你截图里的 GH_* —— //
const env = (...keys: string[]) => {
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.length > 0) return v;
  }
  return "";
};

const owner    = env("GH_OWNER", "OWNER", "GITHUB_OWNER");
const repo     = env("GH_REPO", "REPO");
const token    = env("GH_TOKEN", "GITHUB_TOKEN", "GH_PAT");
const workflow = env("WORKFLOW_ID", "WORKFLOW") || "android-build-matrix.yml";
const ref      = env("GH_BRANCH", "REF") || "main";

const GROQ_API_KEY = env("GROQ_API_KEY");
const GROQ_MODEL   = env("GROQ_MODEL") || "llama-3.1-70b-versatile";
const DEBUG_GROQ   = env("DEBUG_GROQ") === "1";
const SKIP_GITHUB  = env("SKIP_GITHUB") === "1"; // 可选：仅看 Groq 时设为 1

// 缺关键环境变量时，直接返回可读错误
function assertEnv() {
  const miss: string[] = [];
  if (!owner)    miss.push("GH_OWNER/OWNER");
  if (!repo)     miss.push("GH_REPO/REPO");
  if (!token && !SKIP_GITHUB) miss.push("GH_TOKEN/GITHUB_TOKEN/GH_PAT");
  if (!workflow) miss.push("WORKFLOW_ID/WORKFLOW");
  if (!ref)      miss.push("GH_BRANCH/REF");
  if (miss.length) {
    throw new Error(`Missing env: ${miss.join(", ")}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertEnv();

    const { prompt, template = "simple-template", smart = false } =
      (await req.json()) as { prompt: string; template?: string; smart?: boolean };

    // GitHub 客户端（可通过 SKIP_GITHUB 跳过）
    const octokit = !SKIP_GITHUB ? new Octokit({ auth: token }) : null;

    // 工具：创建/更新仓库文件（自动带 base64/sha）
    const upsert = async (path: string, content: string) => {
      if (SKIP_GITHUB) return "skipped";
      const base64 = Buffer.from(content).toString("base64");
      let sha: string | undefined;
      try {
        const { data } = await octokit!.repos.getContent({ owner, repo, path, ref });
        if (!Array.isArray(data) && "sha" in data) sha = (data as any).sha;
      } catch { /* 不存在则创建 */ }
      const res = await octokit!.repos.createOrUpdateFileContents({
        owner, repo, path, branch: ref,
        message: `chore(data): update ${path} at ${new Date().toISOString()}`,
        content: base64, sha,
      });
      return res.data.commit.sha;
    };

    // —— 1) 先写“保底数据”，避免空包 —— //
    const dataset = {
      title: "Lamborghini Encyclopedia",
      generatedAt: new Date().toISOString(),
      prompt, template, smart,
      models: [
        {
          name: "350 GT",
          years: "1964–1966",
          engine: "3.5L V12",
          decade: "1960s",
          summary: "Lamborghini’s first production car.",
          images: ["https://upload.wikimedia.org/wikipedia/commons/3/3a/Lamborghini_350_GT.jpg"],
        },
        {
          name: "Miura",
          years: "1966–1973",
          engine: "3.9L V12",
          decade: "1960s",
          summary: "Iconic mid-engine supercar often credited with starting the genre.",
          images: ["https://upload.wikimedia.org/wikipedia/commons/2/2c/Lamborghini_Miura_S.jpg"],
        },
      ],
    };

    const a1 = await upsert("app/src/main/assets/generated/catalog.json",
      JSON.stringify(dataset, null, 2));
    const a2 = await upsert("app/src/main/assets/generated/about.md",
`# Lamborghini Encyclopedia
Generated at: ${new Date().toISOString()}

Prompt:
> ${prompt}
`);
    const r1 = await upsert("app/src/main/res/raw/catalog.json",
      JSON.stringify(dataset, null, 2));
    const r2 = await upsert("app/src/main/res/raw/about_md.txt",
      `Lamborghini Encyclopedia (about)\nGenerated: ${new Date().toISOString()}`);

    // —— 2) 如开启 smart & 配了 GROQ_API_KEY：请求 Groq 并打印原始返回 —— //
    let groqPreview = "";
    let groqRawLen = 0;
    let groqMode = "mock";

    if (smart && GROQ_API_KEY) {
      groqMode = "groq";

      const body = {
        model: GROQ_MODEL,
        messages: [
          { role: "system",
            content: "You return Android app source code or structured JSON for app generation." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        stream: false,
      };

      const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      const groqJson = await groqResp.json();
      try {
        const dump = JSON.stringify(groqJson, null, 2);
        groqRawLen = dump.length;
        if (DEBUG_GROQ) {
          console.log("[GROQ RAW]", dump.length > 10000 ? dump.slice(0, 10000) + "…(truncated)" : dump);
        }
        await upsert("app/src/main/assets/generated/groq_raw.json", dump);
      } catch (e) {
        if (DEBUG_GROQ) console.log("[GROQ RAW stringify error]", e);
      }

      const contentText = groqJson?.choices?.[0]?.message?.content?.toString() ?? "";
      groqPreview = contentText.slice(0, 200);

      await upsert("app/src/main/assets/generated/groq_content.txt", contentText || "[EMPTY]");

      try {
        const maybeJson = JSON.parse(contentText);
        await upsert("app/src/main/assets/generated/groq_content.json",
          JSON.stringify(maybeJson, null, 2));
      } catch { /* 不是合法 JSON，忽略 */ }
    }

    // —— 3) 触发打包（可通过 SKIP_GITHUB 跳过）—— //
    if (!SKIP_GITHUB) {
      await octokit!.actions.createWorkflowDispatch({
        owner, repo, workflow_id: workflow, ref,
      });
    }

    return NextResponse.json({
      ok: true,
      message: `assets written; ${SKIP_GITHUB ? "skip dispatch" : "workflow dispatched"}`,
      commitSha: { a1, a2, r1, r2 },
      groq: { mode: groqMode, preview: groqPreview, rawLength: groqRawLen, debug: DEBUG_GROQ },
      envUsed: { owner, repo, ref, workflow, skipGithub: SKIP_GITHUB },
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
