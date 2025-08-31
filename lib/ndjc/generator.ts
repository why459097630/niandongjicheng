// lib/ndjc/generator.ts
// NDJC 生成器（日志增强版）
// - 落盘 orchestrator.json / generator.json / api_response.json
// - 输出 index.md 汇总
// - APK 内写入 ndjc_info.json 摘要
// - 向后兼容旧路由的字段/返回结构

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

export type GenerateArgs = {
  repoRoot: string;                   // Packaging-warehouse 路径
  template: string;
  prompt: string;
  buildId?: string;
  anchors?: string[];
  apiResponse?: any;                  // API 原始返回（对象/字符串）
  files?: FileSpec[];                 // 差量写入
  orchestrator?: OrchestratorSummary; // 编排器的结构化成果
  extra?: Record<string, any>;
  maxApiPreviewBytes?: number;        // APK 摘要最多保留多少字节（默认 8KB）
  withGitDiff?: boolean;              // 若环境有 git，则尝试产出 diff
};

export type GenerateResult = {
  changed: string[];
  assetsJsonPath: string;             // app/src/main/assets/ndjc_info.json
  requestDir: string;                 // requests/YYYY-MM-DD/<buildId>
};

// 兼容老路由额外入参（写进 extra）
export type LegacyCompatInput = {
  raw?: any;
  normalized?: any;
};

// 对外入参：允许老字段
export type GenerateInput = Partial<GenerateArgs> & LegacyCompatInput;

// ── 小工具 ──────────────────────────────────────────────────────────
async function exists(p: string) {
  try { await stat(p); return true; } catch { return false; }
}
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
  const bt = "\x60"; // 反引号
  const anchorsLine =
    meta.anchors.length === 0 ? "(none)" : meta.anchors.map(a => `${bt}${a}${bt}`).join(", ");

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

  const outcome: GeneratorOutcome = {
    changedFiles,
    fileCount: changedFiles.length,
    totalBytes,
    gitDiff,
  };
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
    template: info.template,
    prompt: info.prompt,
    buildId: info.buildId,
    anchors: info.anchors,
    fileCount: info.fileCount,
    apiPreview: info.apiPreview,
    extra: info.extra ?? {},
    buildTime: new Date().toISOString(),
  };
  await writeTextFileUtf8(repoRoot, rel, JSON.stringify(payload, null, 2));
  return rel;
}

// ── 对外主流程 ──────────────────────────────────────────────────────
export async function writeFiles(repoRoot: string, files: FileSpec[]) {
  const changed: string[] = [];
  for (const f of files) {
    await writeTextFileUtf8(repoRoot, f.filePath, f.content);
    changed.push(f.filePath);
  }
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
    template, prompt, buildId,
    anchors,
    changedFiles: changed,
    fileCount: outcome.fileCount,
    totalBytes: outcome.totalBytes,
    buildTime: new Date().toISOString(),
    extra: extra ?? {},
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

// ───────────────────────────────────────────────────────────────────
// 兼容层：旧名字/旧返回结构
// ───────────────────────────────────────────────────────────────────

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
    },
    maxApiPreviewBytes: p.maxApiPreviewBytes ?? 8 * 1024,
    withGitDiff: p.withGitDiff ?? true,
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
  return {
    ok: true,
    buildId: full.buildId!,
    injectedAnchors: full.anchors ?? [],
    ...res,
  };
}

// 参数放宽为 any，避免路由直接传 GenerateArgs 时 TS 报错
export function makeSimpleTemplateFiles(opts: any = {}): FileSpec[] {
  const title =
    typeof opts?.appTitle === "string" && opts.appTitle.trim()
      ? opts.appTitle
      : "NDJCApp";
  return [
    {
      filePath: "app/src/main/res/values/strings.xml",
      content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">${title}</string>
</resources>`,
    },
  ];
}

// ✅ 这里改为“常量导出”，并显式导出结果类型，避免被旧声明覆盖
export type CommitAndBuildResult = { ok: boolean; writtenCount: number; note: string };

export const commitAndBuild = async (input: {
  files?: FileSpec[];
  message?: string;
  workflowFile?: string;
  repoRoot?: string;
}): Promise<CommitAndBuildResult> => {
  const writtenCount = Array.isArray(input?.files) ? input.files!.length : 0;
  return {
    ok: true,
    writtenCount,
    note: "Build is handled by CI via repository_dispatch.",
  };
};
