// lib/ndjc/generator.ts
// NDJC 生成器（日志增强版，兼容层宽松模式）
// - 落盘 orchestrator.json / generator.json / api_response.json
// - 输出 index.md 汇总
// - APK 内写入 ndjc_info.json 摘要
// - 兼容旧路由：返回 { ok, writtenCount }；接受任意额外字段

import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "path";
import crypto from "crypto";

export type FileSpec = { filePath: string; content: string };

export type OrchestratorSummary = {
  promptOriginal: string;
  promptCleaned?: string;
  selectedTemplate: string;
  templateCandidates?: Array<{ name: string; score?: number }>;
  anchorsSelected: string[];
  anchorsCandidates?: string[];
  variables?: Record<string, any>;
  llmCalls?: Array<{ name: string; promptPreview: string; responsePreview: string }>;
  notes?: string;
};

export type GeneratorOutcome = {
  changedFiles: Array<{ path: string; bytes: number; sha1: string }>;
  fileCount: number;
  totalBytes: number;
  gitDiff?: string;
};

// ⚠️ 一次性“放宽”：允许任意额外字段，避免路由字面量对象多字段时报错
export type GenerateArgs = {
  repoRoot: string;
  template: string;
  prompt: string;
  buildId?: string;
  anchors?: string[];
  apiResponse?: any;
  files?: FileSpec[];
  orchestrator?: OrchestratorSummary;
  extra?: Record<string, any>;
  maxApiPreviewBytes?: number;
  withGitDiff?: boolean;
  NDJC_APP_NAME?: string;           // 旧路由会用
  [key: string]: any;               // ⬅️ 接受任意额外字段
};

export type GenerateResult = {
  changed: string[];
  assetsJsonPath: string;
  requestDir: string;
};

// 旧路由额外入参（写进 extra）
export type LegacyCompatInput = {
  raw?: any;
  normalized?: any;
  [key: string]: any;               // ⬅️ 同样放宽
};

// 入参：Partial + 宽松
export type GenerateInput = Partial<GenerateArgs> & LegacyCompatInput;

// ── 工具 ────────────────────────────────────────────────────────────
async function exists(p: string) { try { await stat(p); return true; } catch { return false; } }
async function writeTextFileUtf8(root: string, relPath: string, content: string) {
  const full = path.join(root, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, { encoding: "utf8" });
  return relPath;
}
function sha1(buf: Buffer) { return crypto.createHash("sha1").update(buf).digest("hex"); }
function truncateUtf8(s: string, max: number) {
  const b = Buffer.from(s, "utf8");
  if (b.length <= max) return s;
  return b.subarray(0, Math.max(0, max - 3)).toString("utf8") + "...";
}
function jsonStringify(obj: any) {
  try { return typeof obj === "string" ? obj : JSON.stringify(obj ?? {}, null, 2); }
  catch { return String(obj); }
}

// ── 日志与索引 ──────────────────────────────────────────────────────
async function writeRequestIndexMD(
  repoRoot: string, dir: string,
  meta: { template: string; prompt: string; buildId: string; buildTime: string; anchors: string[]; fileCount: number }
) {
  const bt = "\x60";
  const anchorsLine = meta.anchors.length ? meta.anchors.map(a => `${bt}${a}${bt}`).join(", ") : "(none)";
  const md = `# NDJC Build Report

- **Build ID**: \`${meta.buildId}\`
- **Time**: ${meta.buildTime}
- **Template**: \`${meta.template}\`
- **Anchors** (${meta.anchors.length}): ${anchorsLine}
- **Files Changed**: ${meta.fileCount}

## Files
- \`meta.json\`
- \`orchestrator.json\`
- \`generator.json\`
- \`api_response.json\`

> 打开 \`orchestrator.json\` 查看编排器计划与决策；  
> 打开 \`generator.json\` 查看生成器的文件清单/哈希/可选 diff。
`;
  await writeTextFileUtf8(repoRoot, path.join(dir, "index.md"), md);
}

async function writeOrchestratorLog(repoRoot: string, dir: string, o: OrchestratorSummary) {
  await writeTextFileUtf8(repoRoot, path.join(dir, "orchestrator.json"), JSON.stringify(o, null, 2));
}

async function writeGeneratorLog(repoRoot: string, dir: string, files: FileSpec[], withGitDiff: boolean): Promise<GeneratorOutcome> {
  const changedFiles: GeneratorOutcome["changedFiles"] = [];
  let totalBytes = 0;
  for (const f of files) {
    const buf = Buffer.from(f.content, "utf8");
    changedFiles.push({ path: f.filePath, bytes: buf.length, sha1: sha1(buf) });
    totalBytes += buf.length;
  }
  let gitDiff: string | undefined;
  if (withGitDiff) {
    try {
      const r = spawnSync("git", ["diff", "--", ...files.map(f => f.filePath)], { cwd: repoRoot, encoding: "utf8" });
      if (r.status === 0 && r.stdout) gitDiff = r.stdout;
    } catch { /* ignore */ }
  }
  const outcome: GeneratorOutcome = { changedFiles, fileCount: changedFiles.length, totalBytes, gitDiff };
  await writeTextFileUtf8(repoRoot, path.join(dir, "generator.json"), JSON.stringify(outcome, null, 2));
  return outcome;
}

async function writeMeta(repoRoot: string, dir: string, meta: any) {
  await writeTextFileUtf8(repoRoot, path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
}

async function writeApiResponse(repoRoot: string, dir: string, apiResponse: any) {
  await writeTextFileUtf8(repoRoot, path.join(dir, "api_response.json"), jsonStringify(apiResponse));
}

async function writeNdjcInfoAssets(repoRoot: string, info: {
  template: string; prompt: string; buildId: string; anchors: string[];
  fileCount: number; apiPreview: string; extra?: any;
}) {
  const rel = path.join("app", "src", "main", "assets", "ndjc_info.json");
  const payload = {
    template: info.template, prompt: info.prompt, buildId: info.buildId,
    anchors: info.anchors, fileCount: info.fileCount, apiPreview: info.apiPreview,
    extra: info.extra ?? {}, buildTime: new Date().toISOString(),
  };
  await writeTextFileUtf8(repoRoot, rel, JSON.stringify(payload, null, 2));
  return rel;
}

// ── 主流程 ──────────────────────────────────────────────────────────
export async function writeFiles(repoRoot: string, files: FileSpec[]) {
  const changed: string[] = [];
  for (const f of files) { await writeTextFileUtf8(repoRoot, f.filePath, f.content); changed.push(f.filePath); }
  return changed;
}

export async function generateAndroidProject(args: GenerateArgs): Promise<GenerateResult> {
  const {
    repoRoot, template, prompt,
    buildId = `req_${Date.now()}`,
    anchors = [], files = [],
    apiResponse, orchestrator,
    extra, maxApiPreviewBytes = 8 * 1024,
    withGitDiff = true,
  } = args;

  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join("requests", day, buildId);
  const abs = path.join(repoRoot, dir);
  await mkdir(abs, { recursive: true });

  const changed = files.length ? await writeFiles(repoRoot, files) : [];
  const outcome = await writeGeneratorLog(repoRoot, dir, files, withGitDiff);
  if (orchestrator) await writeOrchestratorLog(repoRoot, dir, orchestrator);
  await writeApiResponse(repoRoot, dir, apiResponse);

  const meta = {
    template, prompt, buildId, anchors,
    changedFiles: changed, fileCount: outcome.fileCount, totalBytes: outcome.totalBytes,
    buildTime: new Date().toISOString(), extra: extra ?? {},
  };
  await writeMeta(repoRoot, dir, meta);
  await writeRequestIndexMD(repoRoot, dir, {
    template, prompt, buildId: meta.buildId, buildTime: meta.buildTime,
    anchors, fileCount: outcome.fileCount,
  });

  const apiPreview = truncateUtf8(jsonStringify(apiResponse), maxApiPreviewBytes);
  const assetsJsonPath = await writeNdjcInfoAssets(repoRoot, {
    template, prompt, buildId, anchors, fileCount: outcome.fileCount, apiPreview, extra
  });

  // 兜底：缺布局就补一个（防崩）
  const layoutRel = path.join("app", "src", "main", "res", "layout", "activity_main.xml");
  if (!(await exists(path.join(repoRoot, layoutRel)))) {
    await writeTextFileUtf8(repoRoot, layoutRel,
`<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:orientation="vertical" android:gravity="center_horizontal" android:padding="24dp"
  android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView android:id="@+id/textView" android:text="NDJCApp" android:textSize="18sp"
    android:layout_width="match_parent" android:layout_height="wrap_content"/>
</LinearLayout>`);
  }

  return { changed, assetsJsonPath, requestDir: dir };
}

/** 便捷读取 */
export async function readText(repoRoot: string, relPath: string) {
  return readFile(path.join(repoRoot, relPath), "utf8");
}

// ── 兼容层（宽松） ───────────────────────────────────────────────────
export function resolveWithDefaults(p: GenerateInput): GenerateArgs {
  return {
    repoRoot: p.repoRoot ?? (process.env.PACKAGING_REPO_PATH ?? "/tmp/Packaging-warehouse"),
    template: p.template ?? "core-template",
    prompt: p.prompt ?? "",
    buildId: p.buildId ?? `req_${Date.now()}`,
    anchors: p.anchors ?? [],
    apiResponse: p.apiResponse,
    files: p.files ?? [],
    orchestrator: p.orchestrator,
    extra: {
      ...(p.extra ?? {}),
      ...(p.raw !== undefined ? { raw: p.raw } : {}),
      ...(p.normalized !== undefined ? { normalized: p.normalized } : {}),
      ...((p as any).NDJC_APP_NAME !== undefined ? { NDJC_APP_NAME: (p as any).NDJC_APP_NAME } : {}),
    },
    maxApiPreviewBytes: p.maxApiPreviewBytes ?? 8 * 1024,
    withGitDiff: p.withGitDiff ?? true,
    NDJC_APP_NAME: (p as any).NDJC_APP_NAME,
    ...p,                               // ⬅️ 其余未知字段保留（进一步放宽）
  };
}

export type GenerateResultCompat = GenerateResult & {
  ok: boolean;
  buildId: string;
  injectedAnchors: string[];
};

export async function generateWithAudit(p: GenerateInput): Promise<GenerateResultCompat> {
  const full = resolveWithDefaults(p);
  const res = await generateAndroidProject(full);
  return { ok: true, buildId: full.buildId!, injectedAnchors: full.anchors ?? [], ...res };
}

// 参数放宽为 any，避免路由直接传 GenerateArgs 时 TS 报错
export function makeSimpleTemplateFiles(opts: any = {}): FileSpec[] {
  const title = typeof opts?.appTitle === "string" && opts.appTitle.trim() ? opts.appTitle : "NDJCApp";
  return [{
    filePath: "app/src/main/res/values/strings.xml",
    content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">${title}</string>
</resources>`,
  }];
}

// ── GitHub 集成：提交改动 + 触发工作流 ──────────────────────────────
export type CommitAndBuildResult = { ok: boolean; writtenCount: number; note: string };
export type CommitAndBuildInput = {
  files?: FileSpec[];
  message?: string;          // commit message
  workflowFile?: string;     // 覆盖 WORKFLOW_ID
  repoRoot?: string;
  ref?: string;              // 分支名，默认 GH_BRANCH 或 main
  [key: string]: any;        // 其余字段不阻塞编译
};

// 获取文件 sha（PUT contents API 更新时需要带上）
async function ghGetSha(owner: string, repo: string, token: string, pathRel: string, branch: string) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathRel)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
  });
  if (res.ok) {
    const j: any = await res.json();
    return j?.sha as string | undefined;
  }
  return undefined; // 不存在时返回 undefined
}

// 写/更新单个文件
async function ghPutContent(
  owner: string, repo: string, token: string,
  pathRel: string, content: string, message: string, branch: string
) {
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathRel)}`;
  const sha = await ghGetSha(owner, repo, token, pathRel, branch);
  const body = {
    message,
    branch,
    content: Buffer.from(content, "utf8").toString("base64"),
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(api, {
    method: "PUT",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub PUT ${pathRel} failed: ${res.status} ${t}`);
  }
}

// 触发工作流（支持文件名或数字 ID）
async function ghDispatchWorkflow(
  owner: string, repo: string, token: string,
  workflowIdOrFile: string, branch: string
) {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowIdOrFile}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: branch }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`dispatch failed: ${res.status} ${t}`);
  }
}

// commitAndBuild：先将 files 推到 GitHub，再触发工作流
export const commitAndBuild = async (input: CommitAndBuildInput): Promise<CommitAndBuildResult> => {
  const owner = process.env.GH_OWNER!;
  const repo  = process.env.GH_REPO!;
  const token = process.env.GH_TOKEN!;
  const wf    = input.workflowFile ?? process.env.WORKFLOW_ID!;
  const branch = input.ref ?? process.env.GH_BRANCH ?? "main";

  const files = Array.isArray(input.files) ? input.files : [];
  const writtenCount = files.length;
  const message = input.message ?? `NDJC: ${process.env.NDJC_APP_NAME ?? "automated"} commit`;

  if (!owner || !repo || !token || !wf) {
    return { ok: false, writtenCount, note: "Missing GH_OWNER/GH_REPO/GH_TOKEN or WORKFLOW_ID" };
  }

  // 1) 把生成文件推到仓库（顺序执行，避免并发冲突）
  for (const f of files) {
    const rel = f.filePath.replace(/\\/g, "/").replace(/^\.\//, "");
    await ghPutContent(owner, repo, token, rel, f.content, message, branch);
  }

  // 2) 触发工作流（让 CI 构建 APK）
  await ghDispatchWorkflow(owner, repo, token, wf, branch);

  return {
    ok: true,
    writtenCount,
    note: `pushed ${writtenCount} file(s) to ${branch} & dispatched workflow ${wf}`,
  };
};
