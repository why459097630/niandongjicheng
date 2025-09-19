// app/api/generate-apk/route.ts
import '@/lib/proxy'; // 让 fetch/undici 走系统代理（如 Clash/Proxifier）

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

/* -------------------- 伴生文件（方案B）安全落地 -------------------- */
/**
 * 在线 LLM 生成的 companions 必须真正写入可编译目录（app/src/main/...）
 * 同时维持白名单 + 防目录穿越。
 */
const ALLOWED_SUFFIX = new Set([
  '.kt', '.kts', '.java', '.xml', '.json', '.txt', '.pro', '.md', '.gradle', '.properties',
]);

async function emitCompanions(
  appRoot: string,
  companions: Array<{ path: string; content: string; overwrite?: boolean }>
) {
  if (!companions?.length) return { written: 0, files: [] as string[] };

  const written: string[] = [];
  for (const file of companions) {
    // 1) 归一化相对路径（LLM 需返回以 src/main/... 开头的路径）
    const rel = (file.path || '').replace(/^[/\\]+/, '');
    const dst = path.join(appRoot, rel);
    const ext = path.extname(dst).toLowerCase();

    // 2) 后缀白名单
    if (!ALLOWED_SUFFIX.has(ext)) continue;

    // 3) 防目录穿越 + 仅允许 src/main/*（含 AndroidManifest.xml）
    if (!dst.startsWith(appRoot)) continue;
    const relToRoot = path.relative(appRoot, dst).replace(/\\/g, '/');
    if (
      !relToRoot.startsWith('src/main/') &&
      relToRoot !== 'src/main/AndroidManifest.xml'
    ) continue;

    await fs.mkdir(path.dirname(dst), { recursive: true });

    // 4) 覆盖策略（默认不覆盖）
    try {
      if (!file.overwrite) {
        await fs.access(dst); // 已存在且不允许覆盖 → 跳过
        continue;
      }
    } catch { /* not exists */ }

    await fs.writeFile(dst, file.content ?? '', 'utf8');
    written.push(relToRoot);
  }
  return { written: written.length, files: written };
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
 * 首选 workflow_dispatch 到目标分支；若 422（无触发器/inputs 不兼容等），
 * 退化为 repository_dispatch，并通过 client_payload.ref 指定构建分支。
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

  // ① workflow_dispatch
  const r1 = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ref: branch, ...payload }),
  });
  if (r1.ok) return { ok: true, degraded: false };

  const text1 = await r1.text();

  // ② 任意 422 都尝试回退
  if (r1.status === 422) {
    // ②-1 极简 inputs（仅 runId）
    const r2 = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ref: branch, inputs: { runId: payload?.inputs?.runId } }),
    });
    if (r2.ok) return { ok: true, degraded: true };

    // ②-2 repository_dispatch
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

// 统计关键锚点替换次数（保险丝：=0 时直接中止）
function countCriticalReplacements(applyResult: any[]): number {
  const KEY = new Set([
    'NDJC:PACKAGE_NAME',
    'NDJC:APP_LABEL',
    'NDJC:HOME_TITLE',
    'NDJC:MAIN_BUTTON',
    'BLOCK:PERMISSIONS',
    'BLOCK:INTENT_FILTERS',
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

    // 1) 路径体检
    step = 'check-paths';
    const repoRoot = getRepoPath();
    const tplRoot = process.env.TEMPLATES_DIR || path.join(process.cwd(), 'templates');
    const templateName = String(input?.template || 'core');
    const tplDir = path.join(tplRoot, `${templateName}-template`);

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
      if (process.env.NDJC_OFFLINE === '1' || input?.offline === true) {
        throw new Error('force-offline');
      }
      if (!process.env.GROQ_API_KEY) {
        throw new Error('groq-key-missing');
      }
      const groqModel = process.env.GROQ_MODEL || input?.model || 'llama-3.1-8b-instant';
      // ★ 关键：B 模式 + allowCompanions 由前端入参控制
      o = await orchestrate({
        ...input,
        provider: 'groq',
        model: groqModel,
        forceProvider: 'groq',
      });
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
      // 离线兜底：最小字段，仅方案A
      o = {
        mode: 'A',
        allowCompanions: false,
        template: input.template ?? 'core',
        appName: input.appName ?? input.appTitle ?? 'NDJC core',
        packageId: input.packageId ?? input.packageName ?? 'com.ndjc.demo.core',
      };
      await writeText(runId, '01_orchestrator_mode.txt', `offline (${String(err?.message ?? err)})`);
    }
    await writeJSON(runId, '01_orchestrator.json', o);

    // 3) 计划
    step = 'build-plan';
    const plan = buildPlan(o);
    await writeJSON(runId, '02_plan.json', plan);

    // 4) 物化+应用+清理（使用临时 appRoot）
    step = 'materialize';
    const material = await materializeToWorkspace(o.template);
    const appRoot = material.dstApp;
    await writeText(runId, '04_materialize.txt', `app copied to: ${appRoot}`);

    step = 'apply';
    const applyResult = await applyPlanDetailed(plan);
    await writeJSON(runId, '03_apply_result.json', applyResult);

    // 保险丝：关键锚点替换必须 > 0
    const replacedTotal = countCriticalReplacements(applyResult);
    if (replacedTotal === 0) {
      await writeText(runId, '03c_abort_reason.txt', 'No critical anchors replaced');
      throw new Error('[NDJC] No critical anchors replaced (0) — abort to prevent empty APK.');
    }

    // 伴生文件（方案B）——直接写入 app/src/main/**
    if (o.mode === 'B' && o.allowCompanions && Array.isArray(o.companions) && o.companions.length) {
      const emitted = await emitCompanions(appRoot, o.companions);
      await writeJSON(runId, '03a_companions_emitted.json', emitted);
    } else {
      await writeText(runId, '03a_companions_emitted.txt', 'skip (mode!=B or no companions)');
    }

    // 清理 NDJC/BLOCK 标记
    step = 'cleanup';
    await cleanupAnchors(appRoot);
    await writeText(runId, '03b_cleanup.txt', 'NDJC/BLOCK anchors stripped');

    // 5) 摘要
    step = 'summary';
    const anchors =
      (applyResult || [])
        .flatMap((r: any) =>
          (r?.changes || []).map(
            (c: any) =>
              `- \`${c.marker}\` @ \`${r.file}\` → replaced=${c.replacedCount}, found=${c.found}`
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

## Artifacts
- 00_input.json
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

    // 6) 可选提交日志到默认分支
    step = 'git-commit';
    let commitInfo: any = null;
    if (process.env.NDJC_GIT_COMMIT === '1') {
      commitInfo = await gitCommitPush(`[NDJC run ${runId}] template=${o.template} app=${o.appName}`);
    } else {
      await writeText(runId, '05a_commit_skipped.txt', 'skip commit (NDJC_GIT_COMMIT != 1)');
    }

    // 6.5) 推送“构建分支”：app/ 与 requests/<runId>/ 到同一分支
    step = 'push-app-branch';
    ensureEnv();
    const runBranch = `ndjc-run/${runId}`;
    await ensureBranch(runBranch);

    // 预检 Gradle（防止引号被转义）
    await assertNoEscapedQuotes(appRoot);

    // ① 推 app/
    await pushDirByContentsApi(appRoot, 'app', runBranch, `[NDJC ${runId}] sync app`);

    // ② 推 requests/<runId>/
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

    // 7) 触发 Actions（ref 指 runBranch）
    step = 'dispatch';
    let dispatch: { ok: true; degraded: boolean } | null = null;
    let actionsUrl: string | null = null;

    if (process.env.NDJC_SKIP_ACTIONS === '1' || input?.skipActions === true) {
      await writeText(runId, '05b_actions_skipped.txt', 'skip actions (NDJC_SKIP_ACTIONS == 1 or input.skipActions)');
    } else {
      const inputs = { runId, template: o.template, appTitle: o.appName, packageName: o.packageId };
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
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, step, runId, error: String(e?.message ?? e), stack: e?.stack },
      { status: 500 }
    );
  }
}
