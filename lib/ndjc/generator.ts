// /lib/ndjc/generator.ts
import { Octokit } from "@octokit/rest";
import { randomUUID } from "crypto";

export type ApplyFile = { path: string; content: string; base64?: boolean };

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
  console.log("[NDJC] commit start", { owner, repo, branch, files: files.length });
  const octo = new Octokit({ auth: githubToken });
  const requestId = randomUUID().replace(/-/g, "").slice(0, 20);

  // helper: create or update a file (base64 content)
  const upsertFile = async (path: string, contentB64: string, message: string) => {
    let sha: string | undefined;
    try {
      const { data } = await octo.repos.getContent({ owner, repo, path, ref: branch });
      // @ts-ignore
      sha = (data as any).sha;
    } catch (_) {
      // file not exist -> create
    }
    await octo.repos.createOrUpdateFileContents({
      owner, repo, path, branch, content: contentB64, message, sha,
    });
  };

  const writeJson = (p: string, obj: any, msg: string) =>
    upsertFile(p, Buffer.from(JSON.stringify(obj, null, 2)).toString("base64"), msg);

  // 1) requests/* records
  await writeJson(
    `requests/${requestId}.json`,
    { requestId, meta, count: files.length, at: new Date().toISOString() },
    `NDJC: request ${requestId}`
  );
  console.log("[NDJC] wrote request", requestId);

  await writeJson(
    `requests/${requestId}.plan.json`,
    { requestId, plan: files.map(f => ({ path: f.path, size: f.content.length })) },
    `NDJC: plan ${requestId}`
  );
  console.log("[NDJC] wrote plan", requestId);

  // 2) apply actual files
  const applyLogs: Array<{ path: string; mode: "create" | "update" | "upsert" }> = [];
  for (const f of files) {
    const path = f.path.replace(/^\/+/, "");
    const contentB64 = f.base64 ? f.content : Buffer.from(f.content).toString("base64");
    await upsertFile(path, contentB64, `NDJC:${requestId} apply ${path}`);
    applyLogs.push({ path, mode: "upsert" });
  }
  console.log("[NDJC] applied files", applyLogs.length);

  // 3) apply log
  await writeJson(
    `requests/${requestId}.apply.log.json`,
    { requestId, applied: applyLogs, at: new Date().toISOString() },
    `NDJC: apply.log ${requestId}`
  );
  console.log("[NDJC] wrote apply.log", requestId);

  // 4) dispatch build (compile only)
  await octo.repos.createDispatchEvent({
    owner,
    repo,
    event_type: "ndjc_apply",
    client_payload: { request_id: requestId, branch, reason: "apply" },
  });
  console.log("[NDJC] dispatch ndjc_apply", requestId);

  return { requestId };
}
