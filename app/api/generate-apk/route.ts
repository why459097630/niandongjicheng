// app/api/generate-apk/route.ts
import '@/lib/proxy';

import { NextRequest, NextResponse } from 'next/server';
import { orchestrate } from '@/lib/ndjc/orchestrator';
import {
  buildPlan,
  applyPlanDetailed,
  materializeToWorkspace,
  cleanupAnchors,
} from '@/lib/ndjc/generator';
import * as JournalMod from '@/lib/ndjc/journal';
const Journal: any = (JournalMod as any).default ?? JournalMod;
const newRunId      = Journal.newRunId;
const writeJSON     = Journal.writeJSON;
const writeText     = Journal.writeText;
const gitCommitPush = Journal.gitCommitPush;
const getRepoPath   = Journal.getRepoPath;

import { ensureBranch, pushDirByContentsApi } from '@/lib/ndjc/git-contents';

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const runtime = 'nodejs';

/* -------------------- 伴生文件（方案B） -------------------- */
const COMPANION_ROOT = 'companions';
const COMPANION_WHITELIST = new Set([
  '.kt', '.kts', '.java', '.xml', '.json', '.txt', '.pro', '.md', '.gradle', '.properties',
]);

async function emitCompanions(
  appRoot: string,
  companions: Array<{ path: string; content: string; overwrite?: boolean }>
) {
  if (!companions?.length) return { written: 0, files: [] as string[] };

  const dstRoot = path.join(appRoot, COMPANION_ROOT);
  await fs.mkdir(dstRoot, { recursive: true });

  const written: string[] = [];
  for (const file of companions) {
    const rel = file.path.replace(/^[/\\]+/, '');
    const dst = path.join(dstRoot, rel);
    const ext = path.extname(dst).toLowerCase();

    if (!COMPANION_WHITELIST.has(ext)) continue;
    if (!dst.startsWith(dstRoot)) continue; // 防目录穿越
    await fs.mkdir(path.dirname(dst), { recursive: true });

    try {
      if (!file.overwrite) {
        await fs.access(dst); // 已存在且不允许覆盖 → 跳过
        continue;
      }
    } catch { /* not exists */ }

    await fs.writeFile(dst, file.content ?? '', 'utf8');
    written.push(path.relative(appRoot, dst));
  }
  return { written: written.length, files: written };
}

/* -------------------- 在线获取最新模板 -------------------- */
async function fetchJson(url: string, headers: Record<string, string>) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} :: ${url} :: ${await r.text()}`);
  return r.json();
}
async function fetchFileB64(url: string, headers: Record<string, string>) {
  const j = await fetchJson(url, headers); // contents API 单文件返回 { content, encoding }
  if (!j?.content || j.encoding !== 'base64') {
    // 有些场景不会带 content，改用 download_url 拉 raw
    if (j?.download_url) {
      const rr = await fetch(j.download_url, { headers });
      if (!rr.ok) throw new Error(`${rr.status} ${rr.statusText} :: ${j.download_url}`);
      const buf = Buffer.from(await rr.arrayBuffer());
      return buf;
    }
    throw new Error('unexpected file payload from contents API');
  }
  return Buffer.from(j.content, 'base64');
}

/** 递归拉取 repo/path 到 dstRoot */
async function mirrorRepoPathToDir(
  owner: string, repo: string, ref: string, repoPath: string, dstRoot: string, headers: Record<string, string>
) {
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(repoPath)}?ref=${encodeURIComponent(ref)}`;
  const resp = await fetch(api, { headers });
  if (!resp.ok) {
    throw new Error(`${resp.status} ${resp.statusText} :: ${api} :: ${await resp.text()}`);
  }
  const list = await resp.json();

  if (Array.isArray(list)) {
    // 目录
    await fs.mkdir(path.join(dstRoot, repoPath), { recursive: true });
    for (const item of list) {
      if (item.type === 'dir') {
        await mirrorRepoPathToDir(owner, repo, ref, item.path, dstRoot, headers);
      } else if (item.type === 'file') {
        const buf = await fetchFileB64(
          `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(item.path)}?ref=${encodeURIComponent(ref)}`,
          headers
        );
        const out = path.join(dstRoot, item.path);
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, buf);
      }
    }
  } else {
    // 单文件（一般不走到这里，保留兜底）
    const buf = await fetchFileB64(api, headers);
    const out = path.join(dstRoot, repoPath);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, buf);
  }
}

/** 如果配置了 TEMPLATES_REPO，则把模板拉到 /tmp 并设置 process.env.TEMPLATES_DIR */
async function ensureLatestTemplates(runId: string) {
  const spec = process.env.TEMPLATES_REPO; // owner/repo@ref
  if (!spec) return { mode: 'local', tplDir: process.env.TEMPLATES_DIR || path.join(process.cwd(), 'templates') };

  const m = spec.match(/^([^/]+)\/([^@]+)@(.+)$/);
  if (!m) throw new Error(`Invalid TEMPLATES_REPO: ${spec} (expected owner/repo@ref)`);

  const owner = m[1], repo = m[2], ref = m[3];
  const subPath = (process.env.TEMPLATES_PATH || 'templates').replace(/^\/+/, '').replace(/\/+$/, '');
  const dstRoot = path.join('/tmp', 'ndjc-templates', runId);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GH_PAT) headers.Authorization = `Bearer ${process.env.GH_PAT}`;

  await mirrorRepoPathToDir(owner, repo, ref, subPath, dstRoot, headers);

  const finalDir = path.join(dstRoot, subPath);
  process.env.TEMPLATES_DIR = finalDir;               // 让 generator.ts 走这个目录
  return { mode: 'remote', repo: `${owner}/${repo}`, ref, subPath, tplDir: finalDir };
}

/* -------------------- GitHub Actions 触发工具 -------------------- */
const NEED_ENV = ['GH_OWNER', 'GH_REPO', 'GH_BRANCH', 'WORKFLOW_ID', 'GH_PAT'] as const;

function ensureEnv() {
  const miss = NEED_ENV.filter((k) => !process.env[k]);
  if (miss.length) throw new Error('Missing env: ' + miss.join(', '));
}

function normalizeWorkflowId(wf: string) {
  if (/^\d+$/.test(wf)) return wf;
  if (wf.endsWith('.yml')) return wf;
  return `${wf}.yml`;
}

/**
 * 首选 workflow_dispatch 触发指定分支上的工作流；
 * 若返回 422，退化为 repository_dispatch（工作流在默认分支上跑，使用 client_payload.ref 指向代码分支）。
 */
async function dispatchWorkflow(
  payload: any,
  refBranch?: string
): Promise<{ ok: true; degraded: boolean }> {
  const owner  = process.env.GH_OWNER!;
  const repo   = process.env.GH_REPO!;
  const branch = refBranch || process.env.GH_BRANCH || 'main';
  const wf     = normalizeWorkflowId(process.env.WORKFLOW_ID!);

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/dispatches`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.GH_PAT!}`,
    'X-GitHub-Api-Version': '2022-11-28',
    Accept: 'application/vnd.github+json',
  };

  const r1 = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ref: branch, ...payload }),
  });
  if (r1.ok) return { ok: true, degraded: false };

  const text1 = await r1.text();

  if (r1.status === 422) {
    const r2 = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ref: branch, inputs: { runId: payload?.inputs?.runId } }),
    });
    if (r2.ok) return { ok: true, degraded: true };

    const repoUrl = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
    const r3 = await fetch(repoUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event_type: 'generate-apk',
        client_payload: { ...payload, ref: branch },
      }),
    });
    if (r3.ok) return { ok: true, degraded: true };

    const text2 = await r2.text();
    const text3 = await r3.text();
    throw new Error(`GitHub 422 (fallback failed) :: ${url} :: ${text1} :: ${text2} :: ${text3}`);
  }

  throw new Error(`GitHub ${r1.status} ${r1.statusText} :: ${url} :: ${text1}`);
}

/* -------------------- 小工具 -------------------- */
async function pathExists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

// 预检查：若 build.gradle 出现被转义的引号，提前失败
async function assertNoEscapedQuotes(appRoot: string) {
  for (const f of ['build.gradle', 'build.gradle.kts']) {
    const p = path.join(appRoot, f);
    try {
      const s = await fs.readFile(p, 'utf8');
      if (/\bid\s+\\'/.test(s) || /\\'com\.android\.application\\'/.test(s)) {
        throw new Error(`${f} contains escaped quotes (\\') — check git-contents uploader`);
      }
    } catch { /* ignore missing */ }
  }
}

/** 关键锚点替换计数（保险丝：=0 中止） */
// ★ 方式A：兼容两种命名：BLOCK:* 与 NDJC:BLOCK:*
function countCriticalReplacements(applyResult: any[]): number {
  const KEY = new Set([
    'NDJC:PACKAGE_NAME',
    'NDJC:APP_LABEL',
    'NDJC:HOME_TITLE',
    'NDJC:MAIN_BUTTON',
    'BLOCK:PERMISSIONS',
    'BLOCK:INTENT_FILTERS',
    'NDJC:BLOCK:PERMISSIONS',
    'NDJC:BLOCK:INTENT_FILTERS',
  ]);
  let n = 0;
  for (const f of applyResult || []) {
    for (const c of f?.changes || []) {
      if (KEY.has(c.marker) && (c.replacedCount || 0) > 0) n += c.replacedCount;
    }
  }
  return n;
}

/* -------------------- 路由 -------------------- */
export async function POST(req: NextRequest) {
  let step = 'start';
  let runId = '';
  try {
    // 0) 入参 & runId
    step = 'parse-input';
    const input = await req.json().catch(() => ({}));
    runId = newRunId();
    await writeJSON(runId, '00_input.json', input);

    // 0.5) 在线拉取模板（如配置了 TEMPLATES_REPO）
    step = 'fetch-templates';
    const tplFetch = await ensureLatestTemplates(runId);
    await writeJSON(runId, '00_templates_source.json', tplFetch);

    // 1) 路径体检
    step = 'check-paths';
    const repoRoot = getRepoPath();
    const tplRoot = process.env.TEMPLATES_DIR || path.join(process.cwd(), 'templates');
    const templateName = String(input?.template || input?.template_key || 'core');
    // 兼容两种目录：<key>-template / <key>
    const tplDirCandidates = [
      path.join(tplRoot, `${templateName}-template`),
      path.join(tplRoot, templateName),
    ];
    let tplDir = tplDirCandidates.find(Boolean) as string;
    for (const cand of tplDirCandidates) {
      if (await pathExists(cand)) { tplDir = cand; break; }
    }

    const checks = {
      repoRoot,
      tplRoot,
      tplDir,
      repoRootExists: await pathExists(repoRoot),
      tplRootExists: await pathExists(tplRoot),
      tplDirExists: await pathExists(tplDir),
      env: {
        GH_OWNER: !!process.env.GH_OWNER,
        GH_REPO: !!process.env.GH_REPO,
        GH_BRANCH: !!process.env.GH_BRANCH,
        WORKFLOW_ID: !!process.env.WORKFLOW_ID,
        GH_PAT: !!process.env.GH_PAT,
        TEMPLATES_REPO: process.env.TEMPLATES_REPO || null,
        TEMPLATES_PATH: process.env.TEMPLATES_PATH || 'templates',
        NDJC_OFFLINE: process.env.NDJC_OFFLINE === '1',
        NDJC_SKIP_ACTIONS: process.env.NDJC_SKIP_ACTIONS === '1',
        GROQ_API_KEY: !!process.env.GROQ_API_KEY,
        GROQ_MODEL: process.env.GROQ_MODEL || null,
      },
    };
    await writeJSON(runId, '00_checks.json', checks);

    if (!checks.repoRootExists) throw new Error(`RepoNotFound: ${repoRoot}`);
    if (!checks.tplRootExists) throw new Error(`TemplatesDirNotFound: ${tplRoot}`);
    if (!checks.tplDirExists) throw new Error(`TemplateMissing: ${tplDir}`);

    // 2) 编排：在线优先，离线兜底
    step = 'orchestrate';
    let o: any;
    try {
      if (process.env.NDJC_OFFLINE === '1' || input?.offline === true) throw new Error('force-offline');
      if (!process.env.GROQ_API_KEY) throw new Error('groq-key-missing');

      const groqModel = process.env.GROQ_MODEL || input?.model || 'llama-3.1-8b-instant';
      o = await orchestrate({ ...input, provider: 'groq', model: groqModel, forceProvider: 'groq' });
      await writeText(runId, '01_orchestrator_mode.txt', `online(groq:${groqModel})`);

      if (o && o._trace) {
        await writeJSON(runId, '01a_llm_trace.json', o._trace);
        if (o._trace.request)  await writeJSON(runId, '01a_llm_request.json',  o._trace.request);
        if (o._trace.response) await writeJSON(runId, '01b_llm_response.json', o._trace.response);

        const rawText =
          o._trace.rawText ?? o._trace.text ??
          o._trace.response?.text ?? o._trace.response?.body ?? '';
        if (typeof rawText === 'string' && rawText.trim()) {
          await writeText(runId, '01c_llm_raw.txt', rawText);
        }
      }
    } catch (err: any) {
      // 离线兜底
      o = {
        mode: 'A',
        allowCompanions: false,
        template: input.template ?? input.template_key ?? 'core',
        appName: input.appName ?? input.appTitle ?? 'NDJC core',
        packageId: input.packageId ?? input.packageName ?? 'com.ndjc.demo.core',
      };
      await writeText(runId, '01_orchestrator_mode.txt', `offline (${String(err?.message ?? err)})`);
    }
    await writeJSON(runId, '01_orchestrator.json', o);

    // 3) 计划
    step = 'build-plan';
    const plan = buildPlan({
      ...o,
      template_key: o.template ?? templateName,
    } as any);
    await writeJSON(runId, '02_plan.json', plan);

    // 4) 物化+应用+清理（使用临时 appRoot）
    step = 'materialize';
    const material = await materializeToWorkspace(o.template ?? templateName);
    const appRoot = material.dstApp;
    await writeText(runId, '04_materialize.txt', `app copied to: ${appRoot}`);

    step = 'apply';
    const applyResult = await applyPlanDetailed(plan as any);
    await writeJSON(runId, '03_apply_result.json', applyResult);

    // 保险丝：关键锚点替换必须 > 0（否则直接中止，阻断空包）
    const replacedTotal = countCriticalReplacements(applyResult as any);
    if (replacedTotal === 0) {
      await writeText(runId, '03c_abort_reason.txt', 'No critical anchors replaced');
      throw new Error('[NDJC] No critical anchors replaced (0) — abort to prevent empty APK.');
    }

    step = 'cleanup';
    await cleanupAnchors(appRoot);
    await writeText(runId, '03b_cleanup.txt', 'NDJC/BLOCK anchors stripped');

    // 伴生文件（方案B）
    if (o.mode === 'B' && o.allowCompanions && Array.isArray(o.companions) && o.companions.length) {
      const emitted = await emitCompanions(appRoot, o.companions);
      await writeJSON(runId, '03a_companions_emitted.json', emitted);
    } else {
      await writeText(runId, '03a_companions_emitted.txt', 'skip (mode!=B or no companions)');
    }

    // 5) 摘要
    step = 'summary';
    const anchors =
      (applyResult || [])
        .flatMap((r: any) =>
          (r?.changes || []).map(
            (c: any) =>
              `- \`${c.marker}\` @ \`${path.relative(appRoot, r.file)}\` → replaced=${c.replacedCount}, found=${c.found}`
          )
        )
        .join('\n') || '- (no markers found)';
    const summary = `# NDJC Run ${runId}

- mode: **${o.mode ?? 'A'}**
- allowCompanions: **${!!o.allowCompanions}**
- template: **${o.template}**
- appName: **${o.appName}**
- packageId: **${o.packageId}**
- repo: \`${getRepoPath()}\`
- templates: **${tplFetch.mode}** @ \`${process.env.TEMPLATES_DIR}\`

## Artifacts
- 00_input.json
- 00_templates_source.json
- 00_checks.json
- 01_orchestrator_mode.txt
- 01_orchestrator.json
- 01a_llm_request.json / 01b_llm_response.json / 01c_llm_raw.txt / 01a_llm_trace.json
- 02_plan.json
- 03_apply_result.json
- 03a_companions_emitted.json / .txt
- 03b_cleanup.txt
- 04_materialize.txt

## Anchor Changes
${anchors}
`;
    await writeText(runId, '05_summary.md', summary);

    // 6) 可选提交
    step = 'git-commit';
    let commitInfo: any = null;
    if (process.env.NDJC_GIT_COMMIT === '1') {
      commitInfo = await gitCommitPush(`[NDJC run ${runId}] template=${o.template} app=${o.appName}`);
    } else {
      await writeText(runId, '05a_commit_skipped.txt', 'skip commit (NDJC_GIT_COMMIT != 1)');
    }

    // 6.5) 推送“构建分支”：app/ 与 requests/<runId>/ 同步到同一分支
    step = 'push-app-branch';
    ensureEnv();
    const runBranch = `ndjc-run/${runId}`;
    await ensureBranch(runBranch);

    await assertNoEscapedQuotes(appRoot);

    await pushDirByContentsApi(appRoot, 'app', runBranch, `[NDJC ${runId}] sync app`);

    const reqCandidates = [
      path.join(getRepoPath(), 'requests', runId),
      path.join(process.cwd(), 'requests', runId),
      path.join('/tmp/ndjc', 'requests', runId),
      path.join('/tmp', 'requests', runId),
    ];
    let reqLocalDir: string | null = null;
    for (const p of reqCandidates) {
      try { await fs.access(p); reqLocalDir = p; break; } catch {}
    }
    if (reqLocalDir) {
      await pushDirByContentsApi(reqLocalDir, `requests/${runId}`, runBranch, `[NDJC ${runId}] logs`);
    } else {
      await writeText(runId, '05c_logs_push_skipped.txt', 'skip pushing logs: local requests/<runId> not found');
    }

    // 7) 触发 Actions（ref 指向 runBranch）
    step = 'dispatch';
    let dispatch: { ok: true; degraded: boolean } | null = null;
    let actionsUrl: string | null = null;

    if (process.env.NDJC_SKIP_ACTIONS === '1' || input?.skipActions === true) {
      await writeText(runId, '05b_actions_skipped.txt', 'skip actions (NDJC_SKIP_ACTIONS == 1 or input.skipActions)');
    } else {
      const inputs = {
        runId,
        branch: runBranch,                          // 供 workflow checkout
        template: (plan as any)?.template_key || o.template,
        appTitle: o.appName,
        packageName: o.packageId,
        preflight_mode: 'warn',
      };
      dispatch = await dispatchWorkflow({ inputs }, runBranch);

      const owner = process.env.GH_OWNER!;
      const repo  = process.env.GH_REPO!;
      const wf    = normalizeWorkflowId(process.env.WORKFLOW_ID!);
      actionsUrl  = `https://github.com/${owner}/${repo}/actions/workflows/${wf}`;
    }

    // 8) OK
    return NextResponse.json({
      ok: true,
      runId,
      replaced: replacedTotal,
      committed: !!commitInfo?.committed,
      commit: commitInfo ?? null,
      actionsUrl,
      degraded: dispatch?.degraded ?? null,
      branch: runBranch,
      templates: tplFetch,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, step, runId, error: String(e?.message ?? e), stack: e?.stack },
      { status: 500 }
    );
  }
}
