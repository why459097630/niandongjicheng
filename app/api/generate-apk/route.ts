// app/api/generate-apk/route.ts
import '@/lib/proxy'; // ✅ 让 fetch/undici 走系统代理（如 Clash/Proxifier）

import { NextRequest, NextResponse } from 'next/server';
import { orchestrate } from '@/lib/ndjc/orchestrator';
import {
  buildPlan,
  applyPlanDetailed,
  materializeToWorkspace,
  cleanupAnchors,
} from '@/lib/ndjc/generator';
import * as JournalMod from '@/lib/ndjc/journal';
// 兼容：如果是默认导出就用 default，否则用具名导出集合
const Journal: any = (JournalMod as any).default ?? JournalMod;

const newRunId     = Journal.newRunId;
const writeJSON    = Journal.writeJSON;
const writeText    = Journal.writeText;
const gitCommitPush= Journal.gitCommitPush;
const getRepoPath  = Journal.getRepoPath;

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const runtime = 'nodejs';

/* -------------------- 伴生文件（方案B）安全落地 -------------------- */
const COMPANION_ROOT = 'companions';
const COMPANION_WHITELIST = new Set([
  '.kt',
  '.kts',
  '.java',
  '.xml',
  '.json',
  '.txt',
  '.pro',
  '.md',
  '.gradle',
  '.properties',
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
    } catch {
      /* not exists */
    }

    await fs.writeFile(dst, file.content ?? '', 'utf8');
    written.push(path.relative(appRoot, dst));
  }
  return { written: written.length, files: written };
}

/* -------------------- GitHub Actions 触发工具（保留，但可跳过） -------------------- */
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

async function dispatchWorkflow(payload: any): Promise<{ ok: true; degraded: boolean }> {
  const owner = process.env.GH_OWNER!;
  const repo = process.env.GH_REPO!;
  const branch = process.env.GH_BRANCH || 'main';
  const wf = normalizeWorkflowId(process.env.WORKFLOW_ID!);

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
  if (r1.status === 422 && /Unexpected inputs|cannot be used/i.test(text1)) {
    const r2 = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ref: branch, inputs: { runId: payload?.inputs?.runId } }),
    });
    if (r2.ok) return { ok: true, degraded: true };

    const r3 = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ref: branch }),
    });
    if (r3.ok) return { ok: true, degraded: true };

    const text2 = await r2.text();
    const text3 = await r3.text();
    throw new Error(`GitHub 422 (retry failed) :: ${url} :: ${text1} :: ${text2} :: ${text3}`);
  }

  throw new Error(`GitHub ${r1.status} ${r1.statusText} :: ${url} :: ${text1}`);
}

/* -------------------- 工具 -------------------- */
async function pathExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/* -------------------- 路由：离线兜底 & 可跳过 Actions（方案A/B） -------------------- */
export async function POST(req: NextRequest) {
  let step = 'start';
  let runId = '';
  try {
    // 0) 入参 & runId
    step = 'parse-input';
    const input = await req.json().catch(() => ({}));
    runId = newRunId();
    await writeJSON(runId, '00_input.json', input);

    // 1) 关键路径体检
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

    // 2) 编排：在线优先（强制 Groq），失败或 offline 时兜底
    step = 'orchestrate';
    let o: any;
    try {
      // 显式 offline -> 直接兜底
      if (process.env.NDJC_OFFLINE === '1' || input?.offline === true) {
        throw new Error('force-offline');
      }
      // 没有 Groq key 也兜底（明确原因）
      if (!process.env.GROQ_API_KEY) {
        throw new Error('groq-key-missing');
      }

      // ✅ 强制 provider=groq；模型可用 env 覆盖
      const groqModel = process.env.GROQ_MODEL || input?.model || 'llama-3.1-8b-instant';
      o = await orchestrate({
        ...input,
        provider: 'groq',
        model: groqModel,
        forceProvider: 'groq',
      });
      await writeText(runId, '01_orchestrator_mode.txt', `online(groq:${groqModel})`);

      // LLM trace 落盘（若 orchestrate 返回了 trace）
      if (o && o._trace) {
        await writeJSON(runId, '01a_llm_trace.json', o._trace);
        if (o._trace.request) await writeJSON(runId, '01a_llm_request.json', o._trace.request);
        if (o._trace.response) await writeJSON(runId, '01b_llm_response.json', o._trace.response);

        const rawText =
          o._trace.rawText ??
          o._trace.text ??
          o._trace.response?.text ??
          o._trace.response?.body ??
          '';
        if (typeof rawText === 'string' && rawText.trim()) {
          await writeText(runId, '01c_llm_raw.txt', rawText);
        }
      }
    } catch (err: any) {
      // 兜底：离线方案 A
      o = {
        mode: 'A',
        allowCompanions: false,
        template: input.template ?? 'core',
        appName: input.appName ?? input.appTitle ?? 'NDJC core',
        packageId: input.packageId ?? input.packageName ?? 'com.ndjc.demo.core',
      };
      await writeText(
        runId,
        '01_orchestrator_mode.txt',
        `offline (${String(err?.message ?? err)})`
      );
    }
    await writeJSON(runId, '01_orchestrator.json', o);

    // 3) 生成计划
    step = 'build-plan';
    const plan = buildPlan(o);
    await writeJSON(runId, '02_plan.json', plan);

    // 4) 物化 + 应用 + 清理
    step = 'materialize';
    const material = await materializeToWorkspace(o.template);
    await writeText(runId, '04_materialize.txt', `app copied to: ${material.dstApp}`);

    step = 'apply';
    const applyResult = await applyPlanDetailed(plan);
    await writeJSON(runId, '03_apply_result.json', applyResult);

    step = 'cleanup';
    await cleanupAnchors();
    await writeText(runId, '03b_cleanup.txt', 'NDJC/BLOCK anchors stripped');

    // 方案 B：伴生文件
    if (o.mode === 'B' && o.allowCompanions && Array.isArray(o.companions) && o.companions.length) {
      const emitted = await emitCompanions(path.join(repoRoot, 'app'), o.companions);
      await writeJSON(runId, '03a_companions_emitted.json', emitted);
    } else {
      await writeText(runId, '03a_companions_emitted.txt', 'skip (mode!=B or no companions)');
    }

    // 5) 生成汇总摘要
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
- repo: \`${repoRoot}\`

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

    // 6) 可选 Git 提交
    step = 'git-commit';
    let commitInfo: any = null;
    if (process.env.NDJC_GIT_COMMIT === '1') {
      commitInfo = await gitCommitPush(
        `[NDJC run ${runId}] template=${o.template} app=${o.appName}`
      );
    } else {
      await writeText(runId, '05a_commit_skipped.txt', 'skip commit (NDJC_GIT_COMMIT != 1)');
    }

    // 7) 触发 GitHub Actions（可跳过；带容错）
    step = 'dispatch';
    let dispatch: { ok: true; degraded: boolean } | null = null;
    let actionsUrl: string | null = null;

    if (process.env.NDJC_SKIP_ACTIONS === '1' || input?.skipActions === true) {
      await writeText(
        runId,
        '05b_actions_skipped.txt',
        'skip actions (NDJC_SKIP_ACTIONS == 1 or input.skipActions)'
      );
    } else {
      ensureEnv();
      const inputs = {
        runId,
        template: o.template,
        appTitle: o.appName,
        packageName: o.packageId,
      };
      dispatch = await dispatchWorkflow({ inputs });

      const owner = process.env.GH_OWNER!;
      const repo = process.env.GH_REPO!;
      const wf = normalizeWorkflowId(process.env.WORKFLOW_ID!);
      actionsUrl = `https://github.com/${owner}/${repo}/actions/workflows/${wf}`;
    }

    // 8) 成功响应
    return NextResponse.json({
      ok: true,
      runId,
      committed: !!commitInfo?.committed,
      commit: commitInfo ?? null,
      actionsUrl,
      degraded: dispatch?.degraded ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, step, runId, error: String(e?.message ?? e), stack: e?.stack },
      { status: 500 }
    );
  }
}
