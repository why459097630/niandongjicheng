// lib/ndjc/generator.ts
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path, { dirname } from 'node:path';
import { NdjcOrchestratorOutput, ApplyResult, AnchorChange } from './types';

/* ========= 路径策略 ========= */
function templatesBase() {
  return process.env.TEMPLATES_DIR || path.join(process.cwd(), 'templates');
}
function workRepoRoot() {
  return process.env.NDJC_WORKDIR || '/tmp/ndjc';
}
function repoRoot() {
  // 仓库根（即包含 app/ 与 requests/ 的根目录）
  return process.cwd();
}

/* ========= 模板选择 ========= */
const TEMPLATE_DIR = { simple: 'simple-template', core: 'core-template', form: 'form-template' } as const;
function templateRoot(t: keyof typeof TEMPLATE_DIR) {
  return path.join(templatesBase(), TEMPLATE_DIR[t]);
}

/* ========= 基础工具 ========= */
function pickGradleFile(appRoot: string) {
  const kts = path.join(appRoot, 'build.gradle.kts');
  const groovy = path.join(appRoot, 'build.gradle');
  return existsSync(kts) ? kts : groovy;
}
type Patch = { file: string; replace: Array<{ marker: string; value: string }> };

async function writeJson(p: string, data: any) {
  await fs.mkdir(dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8');
}

function toGradleResConfigs(list?: string): string {
  const raw = (list || '').trim();
  if (!raw) return '';
  const items = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!items.length) return '';
  const quoted = items.map(v => `'${v}'`).join(', ');
  return `resConfigs ${quoted}`;
}

/* ========= locales_config.xml ========= */
async function writeLocalesConfig(appRoot: string, localesList?: string) {
  const list = (localesList || '').trim();
  if (!list) return;
  const items = list.split(',').map(s => s.trim()).filter(Boolean);
  if (!items.length) return;

  const xml =
`<locale-config xmlns:android="http://schemas.android.com/apk/res/android">
${items.map(l => `  <locale android:name="${l}"/>`).join('\n')}
</locale-config>\n`;
  const dir = path.join(appRoot, 'src/main/res/xml');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'locales_config.xml'), xml, 'utf8');
}

/* ========= 生成计划 ========= */
export function buildPlan(o: NdjcOrchestratorOutput): Patch[] {
  const repo = workRepoRoot();
  const appRoot = path.join(repo, 'app');
  const gradleFile = pickGradleFile(appRoot);

  const env = process.env;
  const COMPILE_SDK        = env.NDJC_COMPILE_SDK        ?? '34';
  const MIN_SDK            = env.NDJC_MIN_SDK            ?? '24';
  const TARGET_SDK         = env.NDJC_TARGET_SDK         ?? '34';
  const VERSION_CODE       = env.NDJC_VERSION_CODE       ?? '1';
  const VERSION_NAME       = env.NDJC_VERSION_NAME       ?? '1.0.0';
  const PLUGINS_EXTRA      = env.NDJC_PLUGINS_EXTRA      ?? '';
  const DEPENDENCIES_EXTRA = env.NDJC_DEPENDENCIES_EXTRA ?? '';

  const RES_CONFIGS     = toGradleResConfigs(o.resConfigs);
  const PROGUARD_EXTRA  = o.proguardExtra ?? '';
  const PACKAGING_RULES = o.packagingRules ?? '';

  const LOCALE_CONFIG_ATTR = (o.resConfigs || '').trim() ? 'android:localeConfig="@xml/locales_config"' : '';
  const SIGNING_CONFIG = 'signingConfig signingConfigs.release';

  return [
    {
      file: path.join(appRoot, 'src/main/res/values/strings.xml'),
      replace: [
        { marker: 'NDJC:APP_LABEL',   value: o.appName },
        { marker: 'NDJC:HOME_TITLE',  value: o.homeTitle },
        { marker: 'NDJC:MAIN_BUTTON', value: o.mainButtonText },
      ],
    },
    {
      file: path.join(appRoot, 'src/main/AndroidManifest.xml'),
      replace: [
        { marker: 'NDJC:APP_LABEL', value: o.appName },
        { marker: 'NDJC:LOCALE_CONFIG', value: LOCALE_CONFIG_ATTR },
        { marker: 'BLOCK:PERMISSIONS', value: o.permissionsXml ?? '' },
        { marker: 'BLOCK:INTENT_FILTERS', value: o.intentFiltersXml ?? '' },
      ],
    },
    {
      file: gradleFile,
      replace: [
        { marker: 'NDJC:PACKAGE_NAME',         value: o.packageId },
        { marker: 'NDJC:COMPILE_SDK',          value: process.env.NDJC_COMPILE_SDK ?? '34' },
        { marker: 'NDJC:MIN_SDK',              value: process.env.NDJC_MIN_SDK ?? '24' },
        { marker: 'NDJC:TARGET_SDK',           value: process.env.NDJC_TARGET_SDK ?? '34' },
        { marker: 'NDJC:VERSION_CODE',         value: process.env.NDJC_VERSION_CODE ?? '1' },
        { marker: 'NDJC:VERSION_NAME',         value: process.env.NDJC_VERSION_NAME ?? '1.0.0' },
        { marker: 'NDJC:PLUGINS_EXTRA',        value: process.env.NDJC_PLUGINS_EXTRA ?? '' },
        { marker: 'NDJC:DEPENDENCIES_EXTRA',   value: process.env.NDJC_DEPENDENCIES_EXTRA ?? '' },
        { marker: 'NDJC:SIGNING_CONFIG',       value: SIGNING_CONFIG },
        { marker: 'NDJC:RES_CONFIGS',          value: RES_CONFIGS },
        { marker: 'NDJC:PROGUARD_FILES_EXTRA', value: PROGUARD_EXTRA },
        { marker: 'NDJC:PACKAGING_RULES',      value: PACKAGING_RULES },
      ],
    },
    {
      file: path.join(appRoot, 'src/main/res/values/themes.xml'),
      replace: [{ marker: 'BLOCK:THEME_OVERRIDES', value: o.themeOverridesXml ?? '' }],
    },
    {
      file: path.join(appRoot, 'src/main/java/com/ndjc/app/MainActivity.kt'),
      replace: [
        { marker: 'NDJC:HOME_TITLE',  value: o.homeTitle },
        { marker: 'NDJC:MAIN_BUTTON', value: o.mainButtonText },
      ],
    },
  ];
}

/* ========= 应用计划 ========= */
export async function applyPlanDetailed(plan: Patch[]): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];

  for (const p of plan) {
    let txt = await fs.readFile(p.file, 'utf8');
    const beforeAll = txt;
    const changes: AnchorChange[] = [];

    for (const r of p.replace) {
      const marker = r.marker;
      const escape = (s: string) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

      let found = false;
      let replacedCount = 0;
      let beforeSample: string | undefined;
      let afterSample: string | undefined;

      if (marker.startsWith('BLOCK:')) {
        const re = new RegExp(`<!--\\s*\\/??\\s*${escape(marker)}\\s*-->`, 'g');
        const m = [...txt.matchAll(re)];
        if (m.length > 0) {
          found = true;
          replacedCount = m.length;
          const first = m[0];
          const s = Math.max(0, first.index! - 40);
          const e = Math.min(txt.length, first.index! + first[0].length + 40);
          beforeSample = txt.slice(s, e);

          txt = txt.replace(re, r.value ?? '');
          const ni = txt.indexOf(r.value ?? '', s);
          const ns = Math.max(0, ni - 40);
          const ne = Math.min(txt.length, (ni + (r.value ?? '').length) + 40);
          afterSample = txt.slice(ns, ne);
        }
      } else {
        const idx = txt.indexOf(marker);
        if (idx >= 0) {
          found = true;
          const s = Math.max(0, idx - 40);
          const e = Math.min(txt.length, idx + marker.length + 40);
          beforeSample = txt.slice(s, e);

          const re = new RegExp(escape(marker), 'g');
          replacedCount = (txt.match(re) || []).length;
          txt = txt.replace(re, r.value ?? '');

          const ni = txt.indexOf(r.value ?? '', s);
          const ns = Math.max(0, ni - 40);
          const ne = Math.min(txt.length, (ni + (r.value ?? '').length) + 40);
          afterSample = txt.slice(ns, ne);
        }
      }

      changes.push({ file: p.file, marker, found, replacedCount, beforeSample, afterSample });
    }

    if (txt !== beforeAll) await fs.writeFile(p.file, txt, 'utf8');
    results.push({ file: p.file, changes });
  }
  return results;
}

/* ========= 复制目录 ========= */
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

/** 强制每次运行都先清空工作目录再 materialize */
export async function materializeToWorkspace(templateKey: 'simple' | 'core' | 'form') {
  const repo = workRepoRoot();
  const srcApp = path.join(templateRoot(templateKey), 'app');
  const dstApp = path.join(repo, 'app');

  await fs.rm(repo, { recursive: true, force: true });
  await fs.mkdir(repo, { recursive: true });
  await copyDir(srcApp, dstApp);
  return { dstApp };
}

/* ========= 清理标记 ========= */
const STRIP_EXTS = new Set([
  '.xml', '.gradle', '.kts', '.kt', '.java', '.pro', '.txt', '.json', '.properties', '.cfg', '.ini'
]);
const ANCHOR_PATTERNS: RegExp[] = [
  /<!--\s*\/{0,2}\s*NDJC:[\s\S]*?-->/gs,
  /<!--\s*\/{0,2}\s*BLOCK:[\s\S]*?-->/gs,
  /^\s*\/\/+\s*NDJC:.*$/gm,
  /^\s*\/\/+\s*BLOCK:.*$/gm,
  /\/\*+\s*NDJC:[\s\S]*?\*+\//g,
  /\/\*+\s*BLOCK:[\s\S]*?\*+\//g,
];
function stripRawTokens(text: string): string {
  let out = text.replace(/"NDJC:[^"]*"/g, '""');
  out = out.replace(/NDJC:[^\s<>"']+/g, '');
  return out;
}
async function stripAnchorsInFile(file: string) {
  const ext = path.extname(file).toLowerCase();
  if (!STRIP_EXTS.has(ext)) return;
  let txt = await fs.readFile(file, 'utf8');
  const before = txt;
  for (const re of ANCHOR_PATTERNS) txt = txt.replace(re, '');
  txt = stripRawTokens(txt);
  txt = txt.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
  if (txt !== before) await fs.writeFile(file, txt, 'utf8');
}
async function walkAndStrip(dir: string) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'build' || e.name === '.gradle') continue;
      await walkAndStrip(p);
    } else {
      await stripAnchorsInFile(p);
    }
  }
}
export async function cleanupAnchors(appRoot?: string) {
  const base = appRoot ?? path.join(workRepoRoot(), 'app');
  await walkAndStrip(base);
}

/* ========= 稳态化修复 ========= */
export async function stabilizeGradle(appRoot: string) {
  const gradleFile = pickGradleFile(appRoot);
  let txt = await fs.readFile(gradleFile, 'utf8');
  const before = txt;

  txt = txt.replace/^\uFEFF/, '').replace(/\r\n?/g, '\n'); // 去 BOM + 统一换行
  txt = txt.replace(/android\s*\{\s*\{/g, 'android {').replace(/\}\s*\}/g, '}');
  {
    const idxPlugins = txt.indexOf('plugins');
    const idxAndroid = txt.indexOf('android');
    if (idxPlugins >= 0 && idxAndroid > idxPlugins) {
      const head = txt.slice(idxPlugins, idxAndroid);
      const open = (head.match(/\{/g) || []).length;
      const close = (head.match(/\}/g) || []).length;
      if (open > close) txt = txt.slice(0, idxAndroid).replace(/\s*$/, '\n}\n') + txt.slice(idxAndroid);
    }
  }
  txt = txt.replace(/^\s*\/\/\s*(resConfigs\b[^\n]*)/gm, '$1');
  txt = txt.replace(/"NDJC:[^"]*"/g, '""').replace(/NDJC:[^\s<>"']+/g, '');
  txt = txt.replace(/\n\s*android\s*\{/, '\nandroid {');
  txt = txt.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');

  if (txt !== before) await fs.writeFile(gradleFile, txt, 'utf8');
}

/* ========= 伴生文件 ========= */
export async function ensureAuxFiles(o: NdjcOrchestratorOutput) {
  const appRoot = path.join(workRepoRoot(), 'app');
  if ((o.resConfigs ?? '').trim()) {
    await writeLocalesConfig(appRoot, o.resConfigs);
  }
}

/* ========= 统计 & 写回 ========= */
function countReplacements(detail: ApplyResult[], keyAnchors: string[]): number {
  let n = 0;
  for (const f of detail) {
    for (const c of f.changes) {
      if (keyAnchors.includes(c.marker) && c.replacedCount > 0) n += c.replacedCount;
    }
  }
  return n;
}

async function syncBackAppToRepo() {
  const src = path.join(workRepoRoot(), 'app');
  const dst = path.join(repoRoot(), 'app');

  // 覆盖式写回（排除 build/.gradle）
  await fs.rm(dst, { recursive: true, force: true });
  await copyDir(src, dst);
}

/* ========= 统一入口：生成 + 注入 + 日志 + 写回 ========= */
/**
 * 执行一轮生成，并把修改过的 app/ 写回仓库根目录。
 * 返回：需要提交的路径列表（给 route.ts 用现有 GitHub 推送逻辑一次性提交）。
 */
export async function generateAndSync(
  o: NdjcOrchestratorOutput,
  templateKey: 'simple' | 'core' | 'form',
) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const reqDir = path.join(repoRoot(), 'requests', ts);

  // 1) 清空工作区并 materialize
  await materializeToWorkspace(templateKey);

  // 2) 构建计划 & 应用
  const plan = buildPlan(o);
  const detail = await applyPlanDetailed(plan);
  await ensureAuxFiles(o);
  await cleanupAnchors();

  // 3) 关键锚点计数 & 必落盘日志
  const KEY = [
    'NDJC:PACKAGE_NAME', 'NDJC:APP_LABEL', 'NDJC:HOME_TITLE',
    'NDJC:MAIN_BUTTON', 'BLOCK:PERMISSIONS', 'BLOCK:INTENT_FILTERS'
  ];
  const replacedCount = countReplacements(detail, KEY);

  await writeJson(path.join(reqDir, '02_plan.json'), plan);
  await writeJson(path.join(reqDir, '03_apply_result.json'), detail);

  if (replacedCount === 0) {
    // 即使失败也把 03 写好，方便 CI 保险丝读取
    throw new Error('[NDJC] No critical anchors replaced (0) — abort to prevent empty APK.');
  }

  // 4) 把 /tmp/ndjc/app 写回仓库根的 ./app
  await syncBackAppToRepo();

  // 5) 返回给调用方（route.ts）用于一次性提交
  const commitPaths = [
    'app/**',
    `requests/${ts}/02_plan.json`,
    `requests/${ts}/03_apply_result.json`,
  ];

  return {
    ok: true,
    timestamp: ts,
    replacedCount,
    commitPaths,
    requestDir: `requests/${ts}`,
  };
}
