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

    // 1) 这里先放一个最小 dataset；你可以把 Groq/OpenAI 的结果替换到 dataset 里
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

    // 2) 初始化 Octokit
    const octokit = new Octokit({ auth: token });

    // 3) 工具方法：创建或更新文件
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
        // 文件不存在时会 404，忽略即可
      }

      const res = await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        branch: ref,
        message: `chore(data): update assets (${new Date().toISOString()})`,
        content: base64,
        sha,
      });

      return res.data.commit.sha;
    };

    // 4) 把数据写到 Android APK 可读目录（注意：按你仓库结构，这里是 app/src/main/assets/...）
    const catalogSha = await upsert(
      "app/src/main/assets/generated/catalog.json",
      JSON.stringify(dataset, null, 2),
    );

    const aboutSha = await upsert(
      "app/src/main/assets/generated/about.md",
      `# Lamborghini Encyclopedia
Generated at: ${new Date().toISOString()}

Prompt:
> ${prompt}
`,
    );

    // 5) 触发构建工作流（不需要 inputs 的话就这样）
    await octokit.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: workflow, // 就写文件名：android-build-matrix.yml
      ref,                    // 分支
      // inputs: { }           // 如果 workflow 有 inputs 在这里传
    });

    return NextResponse.json({
      ok: true,
      message: "assets updated & workflow dispatched",
      commitSha: { catalogSha, aboutSha },
    });
  } catch (err: any) {
    console.error("build route error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
