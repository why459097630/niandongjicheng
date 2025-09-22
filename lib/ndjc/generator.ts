// lib/ndjc/generator.ts
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { NdjcOrchestratorOutput, ApplyResult, AnchorChange } from './types';

/* =========================================================
 * 通用 BuildPlan（route.ts 会先合并 preset + anchorsHint 再传进来）
 * =======================================================*/
type BuildPlan = {
  run_id?: string;
  template_key: string;                 // e.g. circle-basic
  preset_used?: string;
  anchors: Record<string, any>;         // NDJC:*
  conditions?: Record<string, boolean>; // IF:*
  lists?: Record<string, any[]>;        // LIST:*
  blocks?: Record<string, string>;      // BLOCK:*
};

/* ========= 路径策略 ========= */
// 模板只读根（可用 TEMPLATES_DIR 覆盖）
function templatesBase() {
  return process.env.TEMPLATES_DIR || path.join(process.cwd(), 'templates');
}
// 工作区（可写），Vercel 上默认 /tmp（可用 NDJC_WORKDIR 覆盖）
function workRepoRoot() {
  return process.env.NDJC_WORKDIR || '/tmp/ndjc';
}

/* ========= 文本类型判断 ========= */
const TEXT_EXT = new Set([
  '.kt','.kts','.java','.xml','.gradle','.pro','.md','.txt','.json','.yaml','.yml','.properties'
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
  return s.replace(/&/g, '&amp;').replace(/\"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ========= materializeToWorkspace =========
 * 同时支持：
 *  - templates/<template_key>/app
 *  - templates/<template_key>（直接是 app 根）
 *  - templates/<name>-template/app
 *  - templates/<name>-template（直接是 app 根）
 */
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
    if (existsSync(c) && (existsSync(path.join(c, 'src')) || existsSync(path.join(c, 'build.gradle')) || existsSync(path.join(c, 'build.gradle.kts')))) {
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

/* ========= buildPlan（与 route.ts 对齐，返回统一对象） ========= */
export function buildPlan(o: NdjcOrchestratorOutput): BuildPlan {
  return {
    run_id: (o as any)?.run_id,
    template_key: (o as any)?.template_key || (o as any)?.template,
    preset_used: (o as any)?.preset_used,
    anchors: (o as any)?.anchors ?? {},
    conditions: (o as any)?.conditions ?? {},
    lists: (o as any)?.lists ?? {},
    blocks: (o as any)?.blocks ?? {},
  };
}

/* ========= applyPlanDetailed：通用注入 ========= */
export async function applyPlanDetailed(plan: BuildPlan): Promise<ApplyResult[]> {
  if (!plan?.template_key) throw new Error('applyPlanDetailed: missing template_key');

  const appRoot = path.join(workRepoRoot(), 'app');
  const results: ApplyResult[] = [];

  // 1) 先处理 Manifest（权限、application 属性、deeplink 等）
  const manifest = await findManifest(appRoot);
  if (manifest) {
    const xml = await fs.readFile(manifest, 'utf8');
    const { text, changes } = applyManifest(xml, plan);
    if (text !== xml) await fs.writeFile(manifest, text, 'utf8');
    results.push({ file: manifest, changes });
  }

  // 2) 遍历其他文本文件做 NDJC/BLOCK/LIST 文本替换
  const files = await allFiles(appRoot);
  for (const f of files) {
    if (f === manifest) continue;
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

/* ========= cleanupAnchors：清理 NDJC/IF/LIST/BLOCK 残留 ========= */
export async function cleanupAnchors(appRoot?: string) {
  const base = appRoot ?? path.join(workRepoRoot(), 'app');
  const files = await allFiles(base);
  const COMMENT_PATTERNS: RegExp[] = [
    /<!--\s*(NDJC:|IF:|LIST:|BLOCK:)[\s\S]*?-->/g,              // XML 注释
    /\/\/\s*(NDJC:|IF:|LIST:|BLOCK:).*/g,                       // // …
    /\/\*+\s*(NDJC:|IF:|LIST:|BLOCK:)[\s\S]*?\*+\//g,           // /* … */
    /NDJC:[^\s<>"']+/g,                                         // 裸标记
  ];
  for (const f of files) {
    if (!isTextFile(f)) continue;
    let t = await fs.readFile(f, 'utf8');
    const before = t;
    for (const re of COMMENT_PATTERNS) t = t.replace(re, '');
    t = t.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
    if (t !== before) await fs.writeFile(f, t, 'utf8');
  }
}

/* ====================== 具体替换实现 ====================== */

// Manifest 定位
async function findManifest(appRoot: string) {
  const cands = [
    path.join(appRoot, 'src/main/AndroidManifest.xml'),
    path.join(appRoot, 'AndroidManifest.xml'),
  ];
  for (const p of cands) {
    try { await fs.access(p); return p; } catch {}
  }
  return null;
}

// 纯文本文件里的 NDJC/BLOCK/LIST 替换（非 manifest）
function applyTextAnchors(src: string, plan: BuildPlan) {
  let text = src;
  const changes: AnchorChange[] = [];

  // 块：<!-- BLOCK:NAME -->…<!-- END_BLOCK -->
  for (const [k, v] of Object.entries(plan.blocks || {})) {
    const name = String(k);
    const pat = new RegExp(`<!--\\s*${escapeRe(name)}\\s*-->[\\s\\S]*?<!--\\s*END_BLOCK\\s*-->`, 'g');
    const before = text;
    text = text.replace(pat, String(v ?? ''));
    if (text !== before) {
      changes.push({ file: '', marker: name, found: true, replacedCount: 1 });
    }
  }

  // 列表：在普通文本里如果出现占位注释就直接替换为拼接文本
  for (const [k, arr] of Object.entries(plan.lists || {})) {
    const name = String(k);
    const payload = (arr || []).map(v => String(v)).join('\n');
    const pat = new RegExp(`<!--\\s*${escapeRe(name)}\\s*-->`, 'g');
    const m = text.match(pat);
    if (m?.length) {
      text = text.replace(pat, payload);
      changes.push({ file: '', marker: name, found: true, replacedCount: m.length });
    }
  }

  // 文本锚点：支持 `NDJC:KEY` 和 `${NDJC:KEY}`
  for (const [k, v] of Object.entries(plan.anchors || {})) {
    const mk = String(k);
    const rep = String(v ?? '');
    const pat1 = new RegExp(escapeRe(mk), 'g');
    const pat2 = new RegExp(`\\$\\{\\s*${escapeRe(mk)}\\s*\\}`, 'g');
    const c1 = (text.match(pat1) || []).length;
    const c2 = (text.match(pat2) || []).length;
    if (c1 + c2 > 0) {
      text = text.replace(pat1, rep).replace(pat2, rep);
      changes.push({ file: '', marker: mk, found: true, replacedCount: c1 + c2 });
    }
  }

  return { text, changes };
}

// Manifest 专用处理：权限、application 属性、deeplink、再跑一次文本锚点
function applyManifest(src: string, plan: BuildPlan) {
  let text = src;
  const changes: AnchorChange[] = [];

  // 1) 权限（IF:PERMISSION.*）
  const permMap: Record<string, string> = {
    'IF:PERMISSION.CAMERA':       'android.permission.CAMERA',
    'IF:PERMISSION.MEDIA':        'android.permission.READ_MEDIA_IMAGES',
    'IF:PERMISSION.NOTIFICATION': 'android.permission.POST_NOTIFICATIONS',
    'IF:PERMISSION.LOCATION':     'android.permission.ACCESS_FINE_LOCATION',
    'IF:PERMISSION.CONTACTS':     'android.permission.READ_CONTACTS',
  };
  for (const [ifKey, perm] of Object.entries(permMap)) {
    if (plan.conditions?.[ifKey]) {
      if (!new RegExp(`<uses-permission[^>]+${escapeRe(perm)}`).test(text)) {
        text = text.replace(/<manifest[^>]*>/, m => `${m}\n    <uses-permission android:name="${perm}"/>`);
        changes.push({ file: '', marker: ifKey, found: true, replacedCount: 1 });
      }
    }
  }

  // 2) application 起始标签：按条件在**起始标签**追加属性
  const appStart = /<application\b([^>]*)>/;
  const m = text.match(appStart);
  if (m) {
    let attrs = m[1] || '';

    if (plan.conditions?.['IF:NETWORK.CLEAR_TEXT'] && !/usesCleartextTraffic=/.test(attrs)) {
      attrs += ` android:usesCleartextTraffic="true"`;
      changes.push({ file: '', marker: 'IF:NETWORK.CLEAR_TEXT', found: true, replacedCount: 1 });
    }
    if (plan.anchors?.['NDJC:THEME_NAME'] && !/android:theme=/.test(attrs)) {
      attrs += ` android:theme="@style/${plan.anchors['NDJC:THEME_NAME']}"`;
      changes.push({ file: '', marker: 'NDJC:THEME_NAME', found: true, replacedCount: 1 });
    }
    if (plan.anchors?.['NDJC:APP_LABEL'] && !/android:label=/.test(attrs)) {
      attrs += ` android:label="${escapeXml(String(plan.anchors['NDJC:APP_LABEL']))}"`;
      changes.push({ file: '', marker: 'NDJC:APP_LABEL@app', found: true, replacedCount: 1 });
    }

    text = text.replace(appStart, `<application${attrs}>`);
  }

  // 3) LIST:DEEPLINK_PATTERNS → 注入 launcher activity 的 intent-filter
  const deeplinks = plan.lists?.['LIST:DEEPLINK_PATTERNS'];
  if (Array.isArray(deeplinks) && deeplinks.length) {
    const payload = deeplinks.map(u => genDataTag(String(u))).join('\n                ');
    const intentPat = /<intent-filter>[\s\S]*?<category android:name="android\.intent\.category\.LAUNCHER"\/>[\s\S]*?<\/intent-filter>/;
    if (intentPat.test(text)) {
      text = text.replace(intentPat, (seg) => {
        if (/android:name="android\.intent\.action\.VIEW"/.test(seg)) return seg; // 已有 VIEW 就跳过
        return seg.replace(
          `<category android:name="android.intent.category.LAUNCHER"/>`,
          `<category android:name="android.intent.category.LAUNCHER"/>
                <action android:name="android.intent.action.VIEW"/>
                ${payload}
                <category android:name="android.intent.category.DEFAULT"/>`
        );
      });
      changes.push({ file: '', marker: 'LIST:DEEPLINK_PATTERNS', found: true, replacedCount: deeplinks.length });
    }
  }

  // 4) 其他 NDJC/BLOCK/LIST 也跑一遍
  const extra = applyTextAnchors(text, plan);
  text = extra.text;
  changes.push(...extra.changes);

  return { text, changes };
}

function genDataTag(url: string) {
  try {
    const u = new URL(url);
    const host = u.host || '';
    const pathName = u.pathname && u.pathname !== '/' ? u.pathname : '';
    return [
      `<data android:scheme="${u.protocol.replace(':','')}"`,
      host ? `      android:host="${host}"` : '',
      pathName ? `      android:pathPrefix="${pathName}"` : '',
      `/>`
    ].filter(Boolean).join('\n                ');
  } catch {
    // 不像 URL，就按自定义 scheme 处理
    return `<data android:scheme="${url}"/>`;
  }
}
