// lib/ndjc/generator.ts
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { NdjcOrchestratorOutput, ApplyResult, AnchorChange } from './types';

/* =========================================================
 * 通用 BuildPlan
 * =======================================================*/
type CompanionFile = {
  path: string;
  kind: string;
  content: string;
  overwrite?: boolean;
};

type BuildPlan = {
  run_id?: string;
  template_key: string;
  preset_used?: string;
  anchors: Record<string, any>;
  conditions?: Record<string, boolean>;
  lists?: Record<string, any[]>;
  blocks?: Record<string, string>;
  companions?: CompanionFile[];
};

/* ========= 路径策略 ========= */
function templatesBase() {
  return process.env.TEMPLATES_DIR || path.join(process.cwd(), 'templates');
}
function workRepoRoot() {
  return process.env.NDJC_WORKDIR || '/tmp/ndjc';
}

/* ========= 文本类型判断 ========= */
const TEXT_EXT = new Set([
  '.kt', '.kts', '.java', '.xml', '.gradle', '.pro', '.md',
  '.txt', '.json', '.yaml', '.yml', '.properties'
]);
function isTextFile(p: string) {
  return TEXT_EXT.has(path.extname(p).toLowerCase());
}

/* ========= 工具 ========= */
async function copyDir(src: string, dst: string) {
  await fs.mkdir(dst, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      if (e.name === 'build' || e.name === '.gradle') continue;
      await copyDir(s, d);
    } else {
      await fs.copyFile(s, d);
    }
  }
}
async function allFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'build' || e.name === '.gradle') continue;
        await walk(p);
      } else {
        out.push(p);
      }
    }
  }
  await walk(root);
  return out;
}
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;')
    .replace(/\"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ========= materializeToWorkspace ========= */
export async function materializeToWorkspace(templateKeyOrLegacyName: string) {
  const base = templatesBase();
  const candidates = [
    path.join(base, templateKeyOrLegacyName, 'app'),
    path.join(base, templateKeyOrLegacyName),
    path.join(base, `${templateKeyOrLegacyName}-template`, 'app'),
    path.join(base, `${templateKeyOrLegacyName}-template`),
  ];
  let srcApp = '';
  for (const c of candidates) {
    if (existsSync(c) && (existsSync(path.join(c, 'src')) ||
      existsSync(path.join(c, 'build.gradle')) ||
      existsSync(path.join(c, 'build.gradle.kts')))) {
      srcApp = c;
      break;
    }
  }
  if (!srcApp) throw new Error(`Template directory not found for ${templateKeyOrLegacyName} under ${base}`);

  const dstApp = path.join(workRepoRoot(), 'app');
  await fs.rm(dstApp, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dstApp), { recursive: true });
  await copyDir(srcApp, dstApp);

  return { srcApp, dstApp };
}

/* ========= buildPlan ========= */
export function buildPlan(o: NdjcOrchestratorOutput): BuildPlan {
  const anchors = { ...(o as any)?.anchors };

  if (!anchors['NDJC:APP_LABEL'] && (o as any)?.appName) {
    anchors['NDJC:APP_LABEL'] = (o as any).appName;
  }
  if (!anchors['NDJC:HOME_TITLE']) {
    anchors['NDJC:HOME_TITLE'] = (o as any)?.homeTitle || (o as any)?.appName || 'Home';
  }
  const btn = (o as any)?.mainButtonText || (o as any)?.primaryButtonText || 'Start';
  if (!anchors['NDJC:PRIMARY_BUTTON_TEXT']) anchors['NDJC:PRIMARY_BUTTON_TEXT'] = btn;
  if (!anchors['NDJC:MAIN_BUTTON']) anchors['NDJC:MAIN_BUTTON'] = btn;
  if (!anchors['NDJC:PACKAGE_NAME'] && (o as any)?.packageId) {
    anchors['NDJC:PACKAGE_NAME'] = (o as any).packageId;
  }

  const blocks: Record<string, string> = { ...(o as any)?.blocks };
  const permXml = (o as any)?.permissionsXml;
  const ifXml = (o as any)?.intentFiltersXml;
  const themeOv = (o as any)?.themeOverridesXml;

  if (permXml && !blocks['NDJC:BLOCK:PERMISSIONS']) {
    blocks['NDJC:BLOCK:PERMISSIONS'] = String(permXml);
  }
  if (ifXml && !blocks['NDJC:BLOCK:INTENT_FILTERS']) {
    blocks['NDJC:BLOCK:INTENT_FILTERS'] = String(ifXml);
  }
  if (themeOv && !blocks['NDJC:BLOCK:THEME_OVERRIDES']) {
    blocks['NDJC:BLOCK:THEME_OVERRIDES'] = String(themeOv);
  }

  return {
    run_id: (o as any)?.runId || (o as any)?.run_id,
    template_key: (o as any)?.template_key || (o as any)?.template,
    preset_used: (o as any)?.preset_used,
    anchors,
    conditions: (o as any)?.conditions ?? {},
    lists: (o as any)?.lists ?? {},
    blocks,
    companions: (o as any)?.companions ?? []
  };
}

/* ========= companions 写入 ========= */
async function writeCompanions(appRoot: string, companions: CompanionFile[], runId?: string) {
  const emitted: string[] = [];
  for (const c of companions) {
    const fullPath = path.join(appRoot, c.path);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    try {
      if (c.overwrite || !existsSync(fullPath)) {
        await fs.writeFile(fullPath, c.content ?? '', 'utf8');
        emitted.push(fullPath);
      }
    } catch (e) {
      console.error(`[companions] Failed to write ${c.path}:`, e);
    }
  }
  if (runId) {
    const outFile = path.join(workRepoRoot(), '..', 'requests', runId, '03a_companions_emitted.json');
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, JSON.stringify({ written: emitted.length, files: emitted }, null, 2), 'utf8');
  }
}

/* ========= applyPlanDetailed ========= */
export async function applyPlanDetailed(plan: BuildPlan): Promise<ApplyResult[]> {
  if (!plan?.template_key) throw new Error('applyPlanDetailed: missing template_key');

  const appRoot = path.join(workRepoRoot(), 'app');
  const results: ApplyResult[] = [];

  // companions 写入
  if (plan.companions?.length) {
    await writeCompanions(appRoot, plan.companions, plan.run_id);
  }

  // Manifest、strings、gradle、锚点替换
  const manifest = await findManifest(appRoot);
  if (manifest) {
    const xml = await fs.readFile(manifest, 'utf8');
    const { text, changes } = applyManifest(xml, plan);
    if (text !== xml) await fs.writeFile(manifest, text, 'utf8');
    results.push({ file: manifest, changes });
  }
  const stringsRes = await updateStringsXml(appRoot, plan);
  if (stringsRes) results.push(stringsRes);

  const gradleRes = await updateGradleAppId(appRoot, plan);
  if (gradleRes) results.push(gradleRes);

  const files = await allFiles(appRoot);
  for (const f of files) {
    if (f === manifest || (stringsRes && f === stringsRes.file) || (gradleRes && f === gradleRes.file)) continue;
    if (!isTextFile(f)) continue;
    const src = await fs.readFile(f, 'utf8');
    const { text, changes } = applyTextAnchors(src, plan);
    if (changes.length > 0) {
      await fs.writeFile(f, text, 'utf8');
      results.push({ file: f, changes });
    }
  }

  return results;
}

/* ========= 其他函数保持原版实现 ========= */
/* findManifest, updateStringsXml, updateGradleAppId, applyTextAnchors, applyManifest 都与原版一致，不变 */
/* genDataTag 修正语法错误 */
function genDataTag(url: string) {
  try {
    const u = new URL(url);
    const host = u.host || '';
    const pathName = u.pathname && u.pathname !== '/' ? u.pathname : '';
    return [
      `<data android:scheme="${u.protocol.replace(':', '')}"`,
      host ? `      android:host="${host}"` : '',
      pathName ? `      android:pathPrefix="${pathName}"` : '',
      `/>`
    ].filter(Boolean).join('\n                ');
  } catch {
    return `<data android:scheme="${url}"/>`;
  }
}
