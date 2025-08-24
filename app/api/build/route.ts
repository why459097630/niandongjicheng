// app/api/build/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";

export const runtime = "nodejs"; // 确保在 Vercel 上有完整日志能力

const owner = process.env.OWNER!;
const repo = process.env.REPO!;
const token = process.env.GITHUB_TOKEN!;
const workflow = process.env.WORKFLOW || "android-build-matrix.yml";
const ref = process.env.REF || "main";

const GROQ_API_KEY = process.env.GROQ_API_KEY || ""; // 需要在 Vercel 配置
const DEBUG_GROQ = process.env.DEBUG_GROQ === "1";   // 可选：启用日志开关
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-70b-versatile";

export async function POST(req: NextRequest) {
  try {
    const { prompt, template = "simple-template", smart = false } =
      (await req.json()) as {
        prompt: string;
        template?: string;
        smart?: boolean;
      };

    const octokit = new Octokit({ auth: token });

    // 小工具：创建/更新仓库文件
    const upsert = async (path: string, content: string) => {
      const base64 = Buffer.from(content).toString("base64");
      let sha: string | undefined;
      try {
        const { data } = await octokit.repos.getContent({
          owner,
          repo,
          path,
          ref,
        });
        if (!Array.isArray(data) && "sha" in data) {
          sha = (data as any).sha;
        }
      } catch {
        /* 文件不存在，忽略 */
      }
      const res = await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        branch: ref,
        message: `chore(data): update ${path} at ${new Date().toISOString()}`,
        content: base64,
        sha,
      });
      return res.data.commit.sha;
    };

    // ====== 1) 默认数据（保证不空包）======
    const dataset = {
      title: "Lamborghini Encyclopedia",
      generatedAt: new Date().toISOString(),
      prompt,
      template,
      smart,
      models: [
        {
          name: "350 GT",
          years: "1964–1966",
          engine: "3.5L V12",
          decade: "1960s",
          summary: "Lamborghini’s first production car.",
          images: [
            "https://upload.wikimedia.org/wikipedia/commons/3/3a/Lamborghini_350_GT.jpg",
          ],
        },
        {
          name: "Miura",
          years: "1966–1973",
          engine: "3.9L V12",
          decade: "1960s",
          summary:
            "Iconic mid-engine supercar often credited with starting the genre.",
          images: [
            "https://upload.wikimedia.org/wikipedia/commons/2/2c/Lamborghini_Miura_S.jpg",
          ],
        },
      ],
    };

    // 先把“保底数据”落盘，避免空包
    const a1 = await upsert(
      "app/src/main/assets/generated/catalog.json",
      JSON.stringify(dataset, null, 2)
    );
    const a2 = await upsert(
      "app/src/main/assets/generated/about.md",
      `# Lamborghini Encyclopedia
Generated at: ${new Date().toISOString()}

Prompt:
> ${prompt}
`
    );
    const r1 = await upsert(
      "app/src/main/res/raw/catalog.json",
      JSON.stringify(dataset, null, 2)
    );
    const r2 = await upsert(
      "app/src/main/res/raw/about_md.txt",
      `Lamborghini Encyclopedia (about)\nGenerated: ${new Date().toISOString()}`
    );

    // ====== 2) 如果启用 smart 且配置了 GROQ_API_KEY，则真实请求 Groq 并打印原始返回 ======
    let groqPreview = "";
    let groqRawLen = 0;
    let groqMode = "mock";

    if (smart && GROQ_API_KEY) {
      groqMode = "groq";
      const body = {
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are an assistant that returns either Android app source code or structured JSON for app generation.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        stream: false,
      };

      const groqResp = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${GROQ_API_KEY}`,
          },
          body: JSON.stringify(body),
        }
      );

      const groqJson = await groqResp.json();
      // —— 打印原始 JSON（可截断，避免过长）——
      try {
        const dump = JSON.stringify(groqJson, null, 2);
        groqRawLen = dump.length;
        if (DEBUG_GROQ) {
          console.log(
            "[GROQ RAW]",
            dump.length > 10000 ? dump.slice(0, 10000) + "…(truncated)" : dump
          );
        }
        // 保存一份原始 JSON 到 assets，便于你在 APK 中/或仓库里直接查看
        await upsert("app/src/main/assets/generated/groq_raw.json", dump);
      } catch (e) {
        if (DEBUG_GROQ) console.log("[GROQ RAW stringify error]", e);
      }

      // —— 提取模型的最终文本内容 —— 
      const contentText =
        groqJson?.choices?.[0]?.message?.content?.toString() ?? "";
      groqPreview = contentText.slice(0, 200);

      // 保存完整文本
      await upsert(
        "app/src/main/assets/generated/groq_content.txt",
        contentText || "[EMPTY]"
      );

      // 如果 contentText 看起来是 JSON，就再额外落一份 JSON 文件
      try {
        const maybeJson = JSON.parse(contentText);
        await upsert(
          "app/src/main/assets/generated/groq_content.json",
          JSON.stringify(maybeJson, null, 2)
        );
      } catch {
        // 不是合法 JSON，忽略
      }
    }

    // ====== 3) 触发打包 ======
    await octokit.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: workflow,
      ref,
    });

    return NextResponse.json({
      ok: true,
      message:
        "assets written to assets/ & res/raw, workflow dispatched; Groq raw logged when enabled",
      commitSha: { a1, a2, r1, r2 },
      groq: {
        mode: groqMode,
        preview: groqPreview,
        rawLength: groqRawLen,
        debug: DEBUG_GROQ,
      },
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
