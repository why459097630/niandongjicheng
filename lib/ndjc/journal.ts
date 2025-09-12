// niandongjicheng/lib/ndjc/journal.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

export function getRepoPath() {
  return process.env.PACKAGING_REPO_PATH || path.resolve('..', 'Packaging-warehouse');
}

export function newRunId(): string {
  const s = new Date().toISOString().replace(/[:.]/g, '-');
  const rnd = crypto.randomBytes(2).toString('hex');
  return `${s}-${rnd}`;
}

export function getRunDir(runId: string) {
  if (!runId) throw new Error('[journal] runId is required');
  return path.join(getRepoPath(), 'requests', runId);
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeJSON(runId: string, name: string, obj: any) {
  const dir = getRunDir(runId);
  await ensureDir(dir);
  const fp = path.join(dir, name);
  await fs.writeFile(fp, JSON.stringify(obj, null, 2), 'utf8');
  return fp;
}

export async function writeText(runId: string, name: string, txt: string) {
  const dir = getRunDir(runId);
  await ensureDir(dir);
  const fp = path.join(dir, name);
  await fs.writeFile(fp, txt, 'utf8');
  return fp;
}

export async function gitCommitPush(message: string) {
  if (process.env.NDJC_GIT_COMMIT !== '1') return { committed: false };
  const repo = getRepoPath();
  const run = (cmd: string, args: string[]) =>
    new Promise<string>((resolve, reject) =>
      execFile(cmd, args, { cwd: repo }, (e, stdout, stderr) =>
        e ? reject(new Error(stderr || e.message)) : resolve(stdout)
      ),
    );

  await run('git', ['add', '-A']);
  await run('git', ['commit', '-m', message]);
  const pushOut = await run('git', ['push']);
  return { committed: true, pushOut };
}
