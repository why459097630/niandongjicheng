// lib/ndjc/generator.ts

import { Octokit } from "@octokit/rest";
import { randomUUID } from "crypto";

type ApplyFile = { path: string; content: string; base64?: boolean };

export async function commitAndBuild({
  owner,
  repo,
  branch = "main",
  files,
  meta,
  githubToken,
}: {
  owner: string;
  repo: string;
  branch?: string;
  files: ApplyFile[];
  meta: Record<string, any>;
  githubToken: string;
}) {
  const octo = new Octokit({ auth: githubToken });

  // 生成 requestId（20位）
  const requestId = randomUUID().replace(/-/g, "").slice(0, 20);

  // 工具函数：更新或创建文件
  const upsertFile = async (
    path: string,
    contentB64: string,
    message: string
  ) => {
    let sha: string | undefined;
    try {
      const { data } = await octo.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });
      // @ts-ignore
      sha = data.sha;
    } catch {}
    await octo.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      branch,
      content: contentB64,
      message,
      sha,
    });
  };

  const writeJson = (p: string, obj: any, msg: string) =>
    upsertFile(
      p,
      Buffer.from(JSON.stringify(obj, null, 2)).toString("base64"),
      msg
    );

  // 1) 写 requests/* 记录
  await writeJson(
    `requests/${requestId}.json`,
    { requestId, meta, count: files.length },
    `NDJC: request ${requestId}`
  );
  await writeJson(
    `requests/${requestId}.plan.json`,
    {
      requestId,
      plan: files.map((f) => ({ path: f.path, size: f.content.length })),
    },
    `NDJC: plan ${requestId}`
  );

  // 2) 落盘差量文件
  const applyLogs: any[] = [];
  for (const f of files) {
    const path = f.path.replace(/^\/+/, "");
    const contentB64 = f.base64
      ? f.content
      : Buffer.from(f.content).toString("base64");
    await upsertFile(
      path,
      contentB64,
      `NDJC:${requestId} apply ${path}`
    );
    applyLogs.push({ path, mode: "upsert" });
  }

  // 3) 写 apply.log
  await writeJson(
    `requests/${requestId}.apply.log.json`,
    { requestId, applied: applyLogs, at: new Date().toISOString() },
    `NDJC: apply.log ${requestId}`
  );

  // 4) 触发构建（只编译不再写文件）
  await octo.repos.createDispatchEvent({
    owner,
    repo,
    event_type: "ndjc_apply",
    client_payload: { request_id: requestId, branch, reason: "apply" },
  });

  return { requestId };
}
