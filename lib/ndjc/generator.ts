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

  // 文本锚点（NDJC:*）
  anchors: Record<string, any>;

  // 条件锚点（IF:*）
  conditions?: Record<string, boolean>;

  // 列表锚点（LIST:*）
  lists?: Record<string, any[]>;

  // 块锚点（NDJC:BLOCK:* 或 BLOCK:*）
  blocks?: Record<string, string>;

  // HOOK 锚点（HOOK:*）
  hooks?: Record<string, string>;

  // 资源锚点（values/xml、drawable/raw 等）
  resources?: {
    values?: {
      strings?: Record<string, string>;
      colors?: Record<string, string>;
      dimens?: Record<string, string>;
    };
    // key -> { content, encoding?, filename? }
    raw?: Record<string, { content: string; encoding?: 'utf8' | 'base64'; filename?: string }>;
    // key -> { content, encoding?, ext? }
    drawable?: Record<string, { content: string; encoding?: 'utf8' | 'base64'; ext?: string }>;
    // 追加 strings.xml 的额外条目（不覆盖模板已有同名键）
    stringsExtraXml?: Record<string, string>;
  };

  // 功能模块（可以转投 LIST:FEATURE_FLAGS 或对应列表）
  features?: Record<string, any>;

  // 路由（可以转投 LIST:ROUTES）
  routes?: Array<string | { path: string; name?: string; icon?: string }>;
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
  '.kt', '.kts', '.java', '.xml', '.gradle', '.pro', '.md', '.txt', '.json', '.yaml', '.yml', '.properties'
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
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function toAndroidResName(s: string) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'ndjc_res';
}
function isLikelyXml(text: string) {
  return /^\s*</.test(text || '');
}

/* ========= materializeToWorkspace =========
 * 兼容 circle-basic / circle-template / circle 等多命名
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
    if (
      existsSync(c) &&
      (existsSync(path.join(c, 'src')) ||
        existsSync(path.join(c, 'build.gradle')) ||
        existsSync(path.join(c, 'build.gradle.kts')))
    ) {
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

/* ========= buildPlan（增强：从 orchestrator 字段兜底 anchors/blocks） ========= */
export function buildPlan(o: NdjcOrchestratorOutput): BuildPlan {
  const anchors = { ...(o as any)?.anchors };

  // ★ 兜底映射：即使 orchestrator 没给 anchors，也能替换关键锚点
  if (!anchors['NDJC:APP_LABEL'] && (o as any)?.appName) {
    anchors['NDJC:APP_LABEL'] = (o as any).appName;
  }
  if (!anchors['NDJC:HOME_TITLE']) {
    anchors['NDJC:HOME_TITLE'] = (o as any)?.homeTitle || (o as any)?.appName || 'Home';
  }
  const btn = (o as any)?.mainButtonText || (o as any)?.primaryButtonText || 'Start';
  if (!anchors['NDJC:PRIMARY_BUTTON_TEXT']) anchors['NDJC:PRIMARY_BUTTON_TEXT'] = btn;
  if (!anchors['NDJC:MAIN_BUTTON']) anchors['NDJC:MAIN_BUTTON'] = btn; // 兼容保险丝统计
  if (!anchors['NDJC:PACKAGE_NAME'] && (o as any)?.packageId) {
    anchors['NDJC:PACKAGE_NAME'] = (o as any).packageId;
  }

  // ★ 把 orchestrator 的 XML 片段物化为 NDJC:BLOCK:* （计数保险丝依赖这些键）
  const blocks: Record<string, string> = { ...(o as any)?.blocks };
  const permXml = (o as any)?.permissionsXml as string | undefined;
  const ifXml   = (o as any)?.intentFiltersXml as string | undefined;
  const themeOv = (o as any)?.themeOverridesXml as string | undefined;

  if (permXml && !blocks['NDJC:BLOCK:PERMISSIONS']) {
    blocks['NDJC:BLOCK:PERMISSIONS'] = String(permXml);
  }
  if (ifXml && !blocks['NDJC:BLOCK:INTENT_FILTERS']) {
    blocks['NDJC:BLOCK:INTENT_FILTERS'] = String(ifXml);
  }
  if (themeOv && !blocks['NDJC:BLOCK:THEME_OVERRIDES']) {
    blocks['NDJC:BLOCK:THEME_OVERRIDES'] = String(themeOv);
  }

  // 新增通道：hooks/features/routes，允许 orchestrator 直接传入
  const hooks = { ...(o as any)?.hooks } as Record<string, string> | undefined;
  const features = (o as any)?.features as Record<string, any> | undefined;
  const routes = (o as any)?.routes as Array<string | { path: string; name?: string; icon?: string }> | undefined;

  // lists 若未给，从 routes/features 兜底生成
  const lists: Record<string, any[]> = { ...(o as any)?.lists } ?? {};
  if (routes && !lists['LIST:ROUTES']) {
    lists['LIST:ROUTES'] = routes.map((r) =>
      typeof r === 'string' ? r : (r.path || '')
    ).filter(Boolean);
  }
  if (features && !lists['LIST:FEATURE_FLAGS']) {
    // 转换为 "key=value" 形式，或仅 key（布尔 true）
    lists['LIST:FEATURE_FLAGS'] = Object.entries(features).map(([k, v]) =>
      typeof v === 'boolean' ? (v ? k : '') : `${k}=${JSON.stringify(v)}`
    ).filter(Boolean);
  }

  // 资源锚点通道
  const resources = (o as any)?.resources;

  return {
    run_id: (o as any)?.runId || (o as any)?.run_id,
    template_key: (o as any)?.template_key || (o as any)?.template,
    preset_used: (o as any)?.preset_used,
    anchors,
    conditions: (o as any)?.conditions ?? {},
    lists,
    blocks,
    hooks,
    resources,
    features,
    routes,
  };
}

/* ========= applyPlanDetailed：通用注入 + 结构化写入 ========= */
export async function applyPlanDetailed(plan: BuildPlan): Promise<ApplyResult[]> {
  if (!plan?.template_key) throw new Error('applyPlanDetailed: missing template_key');

  const appRoot = path.join(workRepoRoot(), 'app');
  const results: ApplyResult[] = [];

  // —— 0) 规范化（把 hooks 合并为 block-like，routes/features 兜底到 lists）——
  const normalized = normalizePlan(plan);

  // 1) Manifest（权限、application 属性、deeplink）
  const manifest = await findManifest(appRoot);
  if (manifest) {
    const xml = await fs.readFile(manifest, 'utf8');
    const { text, changes } = applyManifest(xml, normalized);
    if (text !== xml) await fs.writeFile(manifest, text, 'utf8');
    results.push({ file: manifest, changes });
  }

  // 2) 结构化：strings.xml 资源覆盖（app_name 等）+ 资源落盘
  const stringsRes = await updateStringsXml(appRoot, normalized);
  if (stringsRes) results.push(stringsRes);

  const resRes = await applyResources(appRoot, normalized);
  if (resRes.length) results.push(...resRes);

  // 3) 结构化：Gradle applicationId 覆盖
  const gradleRes = await updateGradleAppId(appRoot, normalized);
  if (gradleRes) results.push(gradleRes);

  // 4) 其他文本文件跑 NDJC/BLOCK/LIST/HOOK 替换
  const files = await allFiles(appRoot);
  for (const f of files) {
    if (f === manifest || (stringsRes && f === stringsRes.file) || (gradleRes && f === gradleRes.file)) continue;
    if (!isTextFile(f)) continue;
    const src = await fs.readFile(f, 'utf8');
    const { text, changes } = applyTextAnchors(src, normalized);
    if (changes.length > 0) {
      await fs.writeFile(f, text, 'utf8');
      results.push({ file: f, changes });
    }
  }

  return results;
}

/* ========= cleanupAnchors：清理 NDJC/IF/LIST/BLOCK/HOOK 残留 ========= */
export async function cleanupAnchors(appRoot?: string) {
  const base = appRoot ?? path.join(workRepoRoot(), 'app');
  const files = await allFiles(base);
  const COMMENT_PATTERNS: RegExp[] = [
    /<!--\s*(NDJC:|IF:|LIST:|BLOCK:|HOOK:)[\s\S]*?-->/g,
    /\/\/\s*(NDJC:|IF:|LIST:|BLOCK:|HOOK:).*/g,
    /\/\*+\s*(NDJC:|IF:|LIST:|BLOCK:|HOOK:)[\s\S]*?\*+\//g,
    /NDJC:[^\s<>"']+/g,
    /HOOK:[^\s<>"']+/g,
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

// —— 规范化：把 hooks 合并为 blocks-like；routes/features 兜底 lists —— //
function normalizePlan(plan: BuildPlan): BuildPlan {
  const out: BuildPlan = { ...plan };

  // HOOK → 当作一种“块锚点”处理（支持注释包围与单点插入）
  if (plan.hooks && Object.keys(plan.hooks).length) {
    out.blocks = { ...(out.blocks || {}) };
    for (const [k, v] of Object.entries(plan.hooks)) {
      const name = k.startsWith('HOOK:') ? k : `HOOK:${k}`;
      // 不覆盖已有块
      if (out.blocks[name] == null) out.blocks[name] = String(v ?? '');
    }
  }

  // routes/features 转投 lists
  out.lists = { ...(out.lists || {}) };
  if (plan.routes && !out.lists['LIST:ROUTES']) {
    out.lists['LIST:ROUTES'] = plan.routes.map((r) =>
      typeof r === 'string' ? r : (r.path || '')
    ).filter(Boolean);
  }
  if (plan.features && !out.lists['LIST:FEATURE_FLAGS']) {
    out.lists['LIST:FEATURE_FLAGS'] = Object.entries(plan.features).map(([k, v]) =>
      typeof v === 'boolean' ? (v ? k : '') : `${k}=${JSON.stringify(v)}`
    ).filter(Boolean);
  }

  return out;
}

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

// 结构化：覆盖 strings.xml 的常用键（再叠加 resources.values.strings、stringsExtraXml）
async function updateStringsXml(appRoot: string, plan: BuildPlan): Promise<ApplyResult | null> {
  const file = path.join(appRoot, 'src/main/res/values/strings.xml');
  try { await fs.access(file); } catch { return null; }

  let txt = await fs.readFile(file, 'utf8');
  const before = txt;
  const changes: AnchorChange[] = [];

  const map: Array<{ key: string; anchor: string }> = [
    { key: 'app_name',       anchor: 'NDJC:APP_LABEL' },
    { key: 'home_title',     anchor: 'NDJC:HOME_TITLE' },
    { key: 'primary_button', anchor: 'NDJC:PRIMARY_BUTTON_TEXT' }, // circle 模板中的命名
  ];

  for (const { key, anchor } of map) {
    const val = plan.anchors?.[anchor];
    if (val == null) continue;
    const re = new RegExp(`<string\\s+name="${escapeRe(key)}">[\\s\\S]*?<\\/string>`);
    if (re.test(txt)) {
      txt = txt.replace(re, `<string name="${key}">${escapeXml(String(val))}</string>`);
      changes.push({ file, marker: anchor, found: true, replacedCount: 1 });
    }
  }

  // 追加 stringsExtraXml（若给）
  const extras = plan.resources?.stringsExtraXml || {};
  const entries = Object.entries(extras);
  if (entries.length) {
    // 简单插入到 </resources> 前（若已存在名为 key 的 string，此处不覆盖）
    for (const [k, v] of entries) {
      const kRe = new RegExp(`<string\\s+name="${escapeRe(k)}">[\\s\\S]*?<\\/string>`);
      if (!kRe.test(txt)) {
        txt = txt.replace(/<\/resources>\s*$/m, `  <string name="${escapeXml(k)}">${escapeXml(v)}</string>\n</resources>`);
        changes.push({ file, marker: `RES:strings:${k}`, found: true, replacedCount: 1 });
      }
    }
  }

  if (txt !== before) {
    await fs.writeFile(file, txt, 'utf8');
    return { file, changes };
  }
  return null;
}

// 资源落盘（values/colors/dimens -> values/ndjc_extras.xml；drawable/raw 写文件）
async function applyResources(appRoot: string, plan: BuildPlan): Promise<ApplyResult[]> {
  const res: ApplyResult[] = [];
  const base = path.join(appRoot, 'src/main/res');

  const values = plan.resources?.values;
  if (values && (Object.keys(values.strings || {}).length || Object.keys(values.colors || {}).length || Object.keys(values.dimens || {}).length)) {
    const outFile = path.join(base, 'values', 'ndjc_extras.xml');
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    const xml = buildValuesXml(values);
    await fs.writeFile(outFile, xml, 'utf8');
    res.push({
      file: outFile,
      changes: [
        ...(Object.keys(values.strings || {}).map(k => ({ file: outFile, marker: `RES:values.strings:${k}`, found: true, replacedCount: 1 } as AnchorChange))),
        ...(Object.keys(values.colors || {}).map(k => ({ file: outFile, marker: `RES:values.colors:${k}`, found: true, replacedCount: 1 } as AnchorChange))),
        ...(Object.keys(values.dimens || {}).map(k => ({ file: outFile, marker: `RES:values.dimens:${k}`, found: true, replacedCount: 1 } as AnchorChange))),
      ]
    });
  }

  // drawable
  const draw = plan.resources?.drawable || {};
  for (const [key, obj] of Object.entries(draw)) {
    const name = toAndroidResName(key);
    // 依据内容推断 ext：XML 则 .xml，默认 .png；允许 obj.ext 覆盖
    const ext = obj.ext || (isLikelyXml(obj.content) ? '.xml' : '.png');
    const outFile = path.join(base, 'drawable', `${name}${ext.startsWith('.') ? ext : `.${ext}`}`);
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    const buf = (obj.encoding === 'base64')
      ? Buffer.from(obj.content || '', 'base64')
      : Buffer.from(obj.content || '', 'utf8');
    await fs.writeFile(outFile, buf);
    res.push({ file: outFile, changes: [{ file: outFile, marker: `RES:drawable:${key}`, found: true, replacedCount: 1 }] });
  }

  // raw
  const raw = plan.resources?.raw || {};
  for (const [key, obj] of Object.entries(raw)) {
    const name = toAndroidResName(obj.filename || key);
    // 默认 .txt；若内容形似 JSON 则 .json
    const ext = guessRawExt(obj.content, obj.filename);
    const outFile = path.join(base, 'raw', `${name}${ext}`);
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    const buf = (obj.encoding === 'base64')
      ? Buffer.from(obj.content || '', 'base64')
      : Buffer.from(obj.content || '', 'utf8');
    await fs.writeFile(outFile, buf);
    res.push({ file: outFile, changes: [{ file: outFile, marker: `RES:raw:${key}`, found: true, replacedCount: 1 }] });
  }

  return res;
}

function buildValuesXml(values?: BuildPlan['resources'] extends infer R ? (R extends { values: infer V } ? V : never) : never) {
  const strings = values?.strings || {};
  const colors  = values?.colors  || {};
  const dimens  = values?.dimens  || {};

  const s = Object.entries(strings).map(([k, v]) =>
    `  <string name="${escapeXml(k)}">${escapeXml(String(v))}</string>`).join('\n');
  const c = Object.entries(colors).map(([k, v]) =>
    `  <color name="${escapeXml(k)}">${escapeXml(String(v))}</color>`).join('\n');
  const d = Object.entries(dimens).map(([k, v]) =>
    `  <dimen name="${escapeXml(k)}">${escapeXml(String(v))}</dimen>`).join('\n');

  const body = [s, c, d].filter(Boolean).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${body}\n</resources>\n`;
}

function guessRawExt(content: string, filename?: string) {
  if (filename && /\.[a-z0-9]+$/i.test(filename)) {
    return filename.slice(filename.lastIndexOf('.'));
  }
  const t = (content || '').trim();
  if (t.startsWith('{') || t.startsWith('[')) return '.json';
  return '.txt';
}

// 结构化：覆盖 Gradle 的 applicationId
async function updateGradleAppId(appRoot: string, plan: BuildPlan): Promise<ApplyResult | null> {
  const fileKts = path.join(appRoot, 'build.gradle.kts');
  const fileGroovy = path.join(appRoot, 'build.gradle');
  const file = existsSync(fileKts) ? fileKts : fileGroovy;
  try { await fs.access(file); } catch { return null; }

  const appId = plan.anchors?.['NDJC:PACKAGE_NAME'];
  if (!appId) return null;

  let txt = await fs.readFile(file, 'utf8');
  const before = txt;
  const changes: AnchorChange[] = [];

  // kts: applicationId("xxx") / groovy: applicationId 'xxx'
  txt = txt
    .replace(/applicationId\("([^"]*)"\)/, `applicationId("${appId}")`)
    .replace(/applicationId\s+'([^']*)'/, `applicationId '${appId}'`);

  if (txt !== before) {
    await fs.writeFile(file, txt, 'utf8');
    changes.push({ file, marker: 'NDJC:PACKAGE_NAME', found: true, replacedCount: 1 });
    return { file, changes };
  }
  return null;
}

// 纯文本文件里的 NDJC/BLOCK/LIST/HOOK 替换（非 manifest）
function applyTextAnchors(src: string, plan: BuildPlan) {
  let text = src;
  const changes: AnchorChange[] = [];

  // 块：<!-- BLOCK:NAME -->…<!-- END_BLOCK -->，以及 <!-- NDJC:BLOCK:NAME -->…-->
  for (const [k, v] of Object.entries(plan.blocks || {})) {
    const name = String(k);
    const nameEsc = escapeRe(name);
    const pats = [
      new RegExp(`<!--\\s*${nameEsc}\\s*-->[\\s\\S]*?<!--\\s*END_BLOCK\\s*-->`, 'g'),
      new RegExp(`<!--\\s*NDJC:BLOCK:${nameEsc}\\s*-->[\\s\\S]*?<!--\\s*END_BLOCK\\s*-->`, 'g'),
    ];
    for (const pat of pats) {
      const before = text;
      text = text.replace(pat, String(v ?? ''));
      if (text !== before) {
        changes.push({ file: '', marker: name, found: true, replacedCount: 1 });
      }
    }
  }

  // HOOK：支持三种形式
  //  A) <!-- HOOK:NAME -->…<!-- END_HOOK -->
  //  B) // HOOK:NAME
  //  C) <!-- HOOK:NAME -->
  for (const [hk, hv] of Object.entries(plan.hooks || {})) {
    const name = hk.startsWith('HOOK:') ? hk : `HOOK:${hk}`;
    const esc = escapeRe(name);

    // A：块状
    const patBlock = new RegExp(`<!--\\s*${esc}\\s*-->[\\s\\S]*?<!--\\s*END_HOOK\\s*-->`, 'g');
    let before = text;
    text = text.replace(patBlock, String(hv ?? ''));
    if (text !== before) {
      changes.push({ file: '', marker: name, found: true, replacedCount: 1 });
      continue;
    }

    // B/C：单点插入，用代码片段替换占位注释
    const patLine1 = new RegExp(`\\/\\/\\s*${esc}\\b.*`, 'g');       // // HOOK:NAME
    const patLine2 = new RegExp(`<!--\\s*${esc}\\s*-->`, 'g');       // <!-- HOOK:NAME -->
    const m1 = text.match(patLine1)?.length || 0;
    const m2 = text.match(patLine2)?.length || 0;
    if (m1 + m2 > 0) {
      text = text.replace(patLine1, String(hv ?? '')).replace(patLine2, String(hv ?? ''));
      changes.push({ file: '', marker: name, found: true, replacedCount: m1 + m2 });
    }
  }

  // 列表：占位注释直接替换
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

// Manifest 专用处理：权限、application 属性、deeplink、再跑一次文本锚点（含 BLOCK/HOOK/LIST）
function applyManifest(src: string, plan: BuildPlan) {
  let text = src;
  const changes: AnchorChange[] = [];

  // 0) 若模板在 Manifest 内部使用了 BLOCK/HOOK 占位，允许直接替换
  for (const [blkKey, blkVal] of Object.entries(plan.blocks || {})) {
    const pat = new RegExp(`<!--\\s*${escapeRe(blkKey)}\\s*-->[\\s\\S]*?<!--\\s*END_BLOCK\\s*-->`, 'g');
    const before = text;
    text = text.replace(pat, String(blkVal ?? ''));
    if (text !== before) {
      changes.push({ file: '', marker: blkKey, found: true, replacedCount: 1 });
    }
  }
  for (const [hk, hv] of Object.entries(plan.hooks || {})) {
    const name = hk.startsWith('HOOK:') ? hk : `HOOK:${hk}`;
    const esc = escapeRe(name);
    const patBlock = new RegExp(`<!--\\s*${esc}\\s*-->[\\s\\S]*?<!--\\s*END_HOOK\\s*-->`, 'g');
    const before = text;
    text = text.replace(patBlock, String(hv ?? ''));
    if (text !== before) {
      changes.push({ file: '', marker: name, found: true, replacedCount: 1 });
    }
  }

  // 1) 条件权限（IF:PERMISSION.*）
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
        text = text.replace(/<manifest[^>]*>/, (m) => `${m}\n    <uses-permission android:name="${perm}"/>`);
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
    const payload = deeplinks.map((u) => genDataTag(String(u))).join('\n                ');
    const intentPat =
      /<intent-filter>[\s\S]*?<category android:name="android\.intent\.category\.LAUNCHER"\/>[\s\S]*?<\/intent-filter>/;
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
      changes.push({
        file: '',
        marker: 'LIST:DEEPLINK_PATTERNS',
        found: true,
        replacedCount: deeplinks.length,
      });
    }
  }

  // 4) 其他 NDJC/BLOCK/LIST/HOOK 也跑一遍（保证非标准占位也能替换）
  const extra = applyTextAnchors(text, plan);
  text = extra.text;
  changes.push(...extra.changes);

  return { text, changes };
}

function genDataTag(urlStr: string) {
  try {
    const u = new URL(urlStr);
    const scheme = u.protocol ? u.protocol.replace(':', '') : '';
    const host = u.host || '';
    const pathName = u.pathname && u.pathname !== '/' ? u.pathname : '';
    const lines: string[] = [];
    lines.push(`<data android:scheme="${scheme}"`);
    if (host) lines.push(`      android:host="${host}"`);
    if (pathName) lines.push(`      android:pathPrefix="${pathName}"`);
    lines.push(`/>`);
    return lines.join('\n                ');
  } catch {
    // 非法 URL，退化为仅 scheme
    return `<data android:scheme="${urlStr}"/>`;
  }
}

/* ========= 显式命名导出（避免 default 导出覆盖） ========= */
export type { BuildPlan };
export { applyTextAnchors }; // 若外部调试需要
