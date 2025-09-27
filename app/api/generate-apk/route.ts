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
const gitCommitPush = Journal.gitCommitPush;
const getRepoPath   = Journal.getRepoPath;

import { ensureBranch, pushDirByContentsApi } from '@/lib/ndjc/git-contents';

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const runtime = 'nodejs';

// -------------------- 伴生文件（方案B）安全落地 --------------------
const COMPANION_ROOT = 'companions';
const COMPANION_WHITELIST = new Set([
  '.kt', '.kts', '.java', '.xml', '.json', '.txt', '.pro', '.md', '.gradle', '.properties',
]);

// 统一把路径里的 \ 或 // 折叠成 /，并去掉开头的 /
function toUnix(p: string): string {
  return (p ?? '').replace(/[\\\/]+/g, '/').replace(/^\//, '');
}

// 仅允许写入 app/ 或 src/ 之下；去掉 ../ 上跳
function sanitizeCompanionPath(rel: string): string | null {
  const norm = toUnix(rel).replace(/\.\.(\/|$)/g, '');
  if (!norm) return null;
  if (!/^app\/|^src\//.test(norm)) return null;
  return norm;
}

async function emitCompanions(
  appRoot: string,
  companions: Array<{ path: string; content: string; overwrite?: boolean }>
) {
  if (!companions?.length) return { written: 0, files: [] as string[] };

  const dstRoot = path.join(appRoot, COMPANION_ROOT);
  await fs.mkdir(dstRoot, { recursive: true });

  const written: string[] = [];
  for (const file of companions) {
    const rel = sanitizeCompanionPath(file.path || '');
    if (!rel) continue;

    const dst = path.join(dstRoot, rel);
    const ext = path.extname(dst).toLowerCase();
    if (!COMPANION_WHITELIST.has(ext)) continue;
    if (!dst.startsWith(dstRoot)) continue;

    await fs.mkdir(path.dirname(dst), { recursive: true });
    try {
      if (!file.overwrite) {
        await fs.access(dst);
        continue;
      }
    } catch {}

    await fs.writeFile(dst, file.content ?? '', 'utf8');
    written.push(path.relative(appRoot, dst));
  }
  return { written: written.length, files: written };
}

// -------------------- 在线获取最新模板（可选） --------------------
async function fetchJson(url: string, headers: Record<string, string>) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} :: ${url} :: ${await r.text()}`);
  return r.json();
}
async function fetchFileB64(url: string, headers: Record<string, string>) {
  const j = await fetchJson(url, headers);
  if (j?.content && j.encoding === 'base64') {
    return Buffer.from(j.content, 'base64');
  }
  if (j?.download_url) {
    const rr = await fetch(j.download_url, { headers });
    if (!rr.ok) throw new Error(`${rr.status} ${rr.statusText} :: ${j.download_url}`);
    return Buffer.from(await rr.arrayBuffer());
  }
  throw new Error('unexpected file payload from contents API');
}
async function mirrorRepoPathToDir(
  owner: string, repo: string, ref: string, repoPath: string, dstRoot: string, headers: Record<string, string>
) {
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(repoPath)}?ref=${encodeURIComponent(ref)}`;
  const resp = await fetch(api, { headers });
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText} :: ${api} :: ${await resp.text()}`);
  const list = await resp.json();

  if (Array.isArray(list)) {
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
    const buf = await fetchFileB64(api, headers);
    const out = path.join(dstRoot, repoPath);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, buf);
  }
}
async function ensureLatestTemplates(runId: string) {
  const spec = process.env.TEMPLATES_REPO;
  if (!spec) {
    return { mode: 'local', tplDir: process.env.TEMPLATES_DIR || path.join(process.cwd(), 'templates') };
  }

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
  process.env.TEMPLATES_DIR = finalDir;
  return { mode: 'remote', repo: `${owner}/${repo}`, ref, subPath, tplDir: finalDir };
}

// -------------------- GitHub Actions 触发工具 --------------------
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
      body: JSON.stringify({ ref: branch, inputs: { runId: payload?.inputs?.runId, branch: payload?.inputs?.branch } }),
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

// -------------------- 小工具 --------------------
async function pathExists(p: string) { try { await fs.access(p); return true; } catch { return false; } }
async function fileExists(p: string) { try { await fs.access(p); return true; } catch { return false; } }

async function assertNoEscapedQuotes(appRoot: string) {
  for (const f of ['build.gradle', 'build.gradle.kts']) {
    const p = path.join(appRoot, f);
    try {
      const s = await fs.readFile(p, 'utf8');
      if (/\bid\s+\\'/.test(s) || /\\'com\.android\.application\\'/.test(s)) {
        throw new Error(`${f} contains escaped quotes (\\') — check git-contents uploader`);
      }
    } catch {}
  }
}
function countCriticalReplacements(applyResult: any[]): number {
  const KEY = new Set([
    'NDJC:PACKAGE_NAME',
    'NDJC:APP_LABEL',
    'NDJC:HOME_TITLE',
    'NDJC:MAIN_BUTTON',
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

// -------------------- 本地请求目录与写入封装 --------------------
function runLocalRoot(runId: string) {
  const base = process.env.NDJC_REQ_DIR || '/tmp/ndjc/requests';
  return path.join(base, runId);
}
async function ensureRunDir(runId: string) {
  const dir = runLocalRoot(runId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
async function jWriteJSON(runId: string, name: string, data: any) {
  const dir = await ensureRunDir(runId);
  const file = path.join(dir, name);
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}
async function jWriteText(runId: string, name: string, text: string) {
  const dir = await ensureRunDir(runId);
  const file = path.join(dir, name);
  await fs.writeFile(file, text ?? '', 'utf8');
}
async function assertCoreArtifactsOrExplain(runId: string) {
  const dir = runLocalRoot(runId);
  const plan = path.join(dir, '02_plan.json');
  const apply = path.join(dir, '03_apply_result.json');

  const has02 = await fileExists(plan);
  const has03 = await fileExists(apply);

  if (has02 && has03) return true;

  const miss = [
    !has02 ? '02_plan.json' : null,
    !has03 ? '03_apply_result.json' : null,
  ].filter(Boolean).join(', ');

  await jWriteText(
    runId,
    '05e_pre_dispatch_error.txt',
    `[NDJC] Pre-dispatch guard: missing core artifact(s): ${miss}\n` +
    `runDir: ${dir}\n` +
    `Hint: ensure applyPlanDetailed() executed and wrote 03_apply_result.json.`
  );
  return false;
}

// -------------------- 路由 --------------------
export async function POST(req: NextRequest) {
  let step = 'start';
  let runId = '';
  try {
    step = 'parse-input';
    const input = await req.json().catch(() => ({}));
    runId = (Journal.newRunId?.() ?? `ndjc-${Date.now()}`);
    await jWriteJSON(runId, '00_input.json', input);

    step = 'fetch-templates';
    const tplFetch = await ensureLatestTemplates(runId);
    await jWriteJSON(runId, '00_templates_source.json', tplFetch);

    step = 'check-paths';
    const repoRoot = getRepoPath();
    const tplRoot = process.env.TEMPLATES_DIR || path.join(process.cwd(), 'templates');
    const templateName = String(input?.template || 'circle-basic');

    const tplDirCandidates = [
      path.join(tplRoot, `${templateName}`),
      path.join(tplRoot, `${templateName}-template`),
    ];
    let tplDirExists = false;
    for (const cand of tplDirCandidates) {
      if (await pathExists(cand)) { tplDirExists = true; break; }
    }

    const checks = {
      repoRoot,
      tplRoot,
      templateName,
      tplDirExists,
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
    await jWriteJSON(runId, '00_checks.json', checks);

    if (!await pathExists(repoRoot)) throw new Error(`RepoNotFound: ${repoRoot}`);
    if (!await pathExists(tplRoot)) throw new Error(`TemplatesDirNotFound: ${tplRoot}`);
    if (!tplDirExists) throw new Error(`TemplateMissing: ${templateName} (under ${tplRoot})`);

    // 2) 编排
    step = 'orchestrate';
    let o: any;
    try {
      if (process.env.NDJC_OFFLINE === '1' || input?.offline === true) throw new Error('force-offline');
      if (!process.env.GROQ_API_KEY) throw new Error('groq-key-missing');

      const groqModel = process.env.GROQ_MODEL || input?.model || 'llama-3.1-8b-instant';
      o = await orchestrate({ ...input, provider: 'groq', model: groqModel, forceProvider: 'groq' });
      await jWriteText(runId, '01_orchestrator_mode.txt', `online(groq:${groqModel})`);

      if (o && o._trace) {
        await jWriteJSON(runId, '01a_llm_trace.json', o._trace);
        if (o._trace.request)  await jWriteJSON(runId, '01a_llm_request.json',  o._trace.request);
        if (o._trace.response) await jWriteJSON(runId, '01b_llm_response.json', o._trace.response);

        const rawText =
          o._trace.rawText ?? o._trace.text ??
          o._trace.response?.text ?? o._trace.response?.body ?? '';
        if (typeof rawText === 'string' && rawText.trim()) {
          await jWriteText(runId, '01c_llm_raw.txt', rawText);
        }
      }
    } catch (err: any) {
      o = {
        mode: 'A',
        allowCompanions: false,
        template: input.template ?? 'circle-basic',
        appName: input.appName ?? input.appTitle ?? 'NDJC App',
        packageId: input.packageId ?? input.packageName ?? 'com.ndjc.demo.app',
      };
      await jWriteText(runId, '01_orchestrator_mode.txt', `offline (${String(err?.message ?? err)})`);
    }
    await jWriteJSON(runId, '01_orchestrator.json', o);

    // 3) 计划
    step = 'build-plan';
    const plan = buildPlan(o);
    await jWriteJSON(runId, '02_plan.json', plan);

    // 4) 物化 + 应用 + 清理
    step = 'materialize';
    const material = await materializeToWorkspace(o.template);
    const appRoot = material.dstApp;
    await jWriteText(runId, '04_materialize.txt', `app copied to: ${appRoot}`);

    step = 'apply';
    const applyResult = await applyPlanDetailed(plan);
    await jWriteJSON(runId, '03_apply_result.json', applyResult);

    const replacedTotal = countCriticalReplacements(applyResult);
    if (replacedTotal === 0) {
      await jWriteText(runId, '03c_abort_reason.txt', 'No critical anchors replaced');
      throw new Error('[NDJC] No critical anchors replaced (0) — abort to prevent empty APK.');
    }

    const rawDir = path.join(appRoot, 'src', 'main', 'res', 'raw');
    await fs.mkdir(rawDir, { recursive: true });
    const posts = plan?.lists?.posts ?? plan?.lists?.feed ?? null;
    if (Array.isArray(posts) && posts.length) {
      const out = path.join(rawDir, 'seed_posts.json');
      try {
        await fs.access(out);
        await jWriteText(runId, '03a2_seed_json.txt', 'skip emit seed_posts.json (already exists)');
      } catch {
        await fs.writeFile(out, JSON.stringify(posts, null, 2), 'utf8');
        await jWriteText(runId, '03a2_seed_json.txt', `emit seed_posts.json (items=${posts.length})`);
      }
    } else {
      await jWriteText(runId, '03a2_seed_json.txt', 'skip emit seed_posts.json (no lists.posts in plan)');
    }

    step = 'cleanup';
    await cleanupAnchors(appRoot);
    await jWriteText(runId, '03b_cleanup.txt', 'NDJC/BLOCK anchors stripped');

    // 伴生文件（方案B）
    if (o.mode === 'B' && o.allowCompanions && Array.isArray(o.companions) && o.companions.length) {
      const emitted = await emitCompanions(appRoot, o.companions);
      await jWriteJSON(runId, '03a_companions_emitted.json', emitted);
    } else {
      await jWriteText(runId, '03a_companions_emitted.txt', 'skip (mode!=B or no companions)');
    }

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
- 03a2_seed_json.txt
- 03b_cleanup.txt
- 04_materialize.txt

## Anchor Changes
${anchors}
`;
    await jWriteText(runId, '05_summary.md', summary);

    // 6) 可选提交
    step = 'git-commit';
    let commitInfo: any = null;
    if (process.env.NDJC_GIT_COMMIT === '1') {
      commitInfo = await gitCommitPush(`[NDJC run ${runId}] template=${o.template} app=${o.appName}`);
    } else {
      await jWriteText(runId, '05a_commit_skipped.txt', 'skip commit (NDJC_GIT_COMMIT != 1)');
    }

    // 6.5) 推送构建分支
    step = 'push-app-branch';
    ensureEnv();
    const runBranch = `ndjc-run/${runId}`;
    await ensureBranch(runBranch);

    await assertNoEscapedQuotes(appRoot);

    await pushDirByContentsApi(appRoot, 'app', runBranch, `[NDJC ${runId}] sync app`, { wipeFirst: true });

    const reqLocalDir = runLocalRoot(runId);
    const okCore = await assertCoreArtifactsOrExplain(runId);
    if (!okCore) {
      await pushDirByContentsApi(reqLocalDir, `requests/${runId}`, runBranch, `[NDJC ${runId}] logs (pre-dispatch error)`);
      throw new Error(`[NDJC] Missing core artifacts under requests/${runId} — abort before dispatch.`);
    }
    await pushDirByContentsApi(reqLocalDir, `requests/${runId}`, runBranch, `[NDJC ${runId}] logs`);

    // 7) 触发 Actions（工作流文件来自 main / GH_BRANCH；构建代码来自 runBranch）
    step = 'dispatch';
    let dispatch: { ok: true; degraded: boolean } | null = null;
    let actionsUrl: string | null = null;

    if (process.env.NDJC_SKIP_ACTIONS === '1' || input?.skipActions === true) {
      await jWriteText(runId, '05b_actions_skipped.txt', 'skip actions (NDJC_SKIP_ACTIONS == 1 or input.skipActions)');
    } else {
      const inputs = {
        runId,
        branch: runBranch,
        template: o.template,
        appTitle: o.appName,
        packageName: o.packageId,
        preflight_mode: input?.preflight_mode || 'warn',
      };

      const workflowRef = process.env.GH_BRANCH || 'main';
      dispatch = await dispatchWorkflow({ inputs }, workflowRef);

      const owner = process.env.GH_OWNER!;
      const repo  = process.env.GH_REPO!;
      const wf    = normalizeWorkflowId(process.env.WORKFLOW_ID!);
      actionsUrl  = `https://github.com/${owner}/${repo}/actions/workflows/${wf}`;
    }

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
