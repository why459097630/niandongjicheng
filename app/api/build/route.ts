// app/api/build/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";

const owner = process.env.OWNER!;
const repo = process.env.REPO!;
const token = process.env.GITHUB_TOKEN!;
const workflow = process.env.WORKFLOW || "android-build-matrix.yml";
const ref = process.env.REF || "main";

export async function POST(req: NextRequest) {
  try {
    const { prompt, template = "simple-template", smart = false } =
      (await req.json()) as {
        prompt: string;
        template?: string;
        smart?: boolean;
      };

    // 你可以把这里替换成 Groq/OpenAI 真返回
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

    const octokit = new Octokit({ auth: token });

    // 工具函数：创建或更新文件到指定 path
    const upsert = async (path: string, content: string) => {
      const base64 = Buffer.from(content).toString("base64");
      let sha: string | undefined;

      try {
        const { data } = await octokit.repos.getContent({
          owner, repo, path, ref,
        });
        if (!Array.isArray(data) && "sha" in data) {
          sha = (data as any).sha;
        }
      } catch { /* 文件不存在忽略 */ }

      const res = await octokit.repos.createOrUpdateFileContents({
        owner, repo, path, branch: ref,
        message: `chore(data): update assets ${new Date().toISOString()}`,
        content: base64, sha,
      });
      return res.data.commit.sha;
    };

    // 写进 assets（APK 内路径：assets/generated/...）
    const a1 = await upsert("app/src/main/assets/generated/catalog.json",
      JSON.stringify(dataset, null, 2));
    const a2 = await upsert("app/src/main/assets/generated/about.md",
      `# Lamborghini Encyclopedia
Generated at: ${new Date().toISOString()}

Prompt:
> ${prompt}
`);

    // 同步一份到 res/raw（APK 内路径：res/raw/...）
    const r1 = await upsert("app/src/main/res/raw/catalog.json",
      JSON.stringify(dataset, null, 2));
    const r2 = await upsert("app/src/main/res/raw/about_md.txt",
      `Lamborghini Encyclopedia (about)\nGenerated: ${new Date().toISOString()}`);

    // 触发打包
    await octokit.actions.createWorkflowDispatch({
      owner, repo, workflow_id: workflow, ref,
    });

    return NextResponse.json({
      ok: true,
      message: "assets written to assets/ & res/raw, workflow dispatched",
      commitSha: { a1, a2, r1, r2 },
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
