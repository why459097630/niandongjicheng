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
import * as yaml from 'js-yaml';

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

/* -------------------- 在线获取最新模板 -------------------- */
async function fetchJson(url: string, headers: Record<string, string>) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} :: ${url} :: ${await r.text()}`);
  return r.json();
}
async function fetchFileB64(url: string, headers: Record<string, string>) {
  const j = await fetchJson(url, headers);
  if (!j?.content || j.encoding !== 'base64') {
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
  process.env.TEMPLATES_DIR = finalDir;
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
    if (r2.ok
