// lib/ndjc/generator.ts
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path, { dirname } from 'node:path';
import { NdjcOrchestratorOutput, ApplyResult, AnchorChange } from './types';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/* ========= 路径策略 ========= */
// （A 方案）模板根目录解析：优先使用远端仓库的最新模板
async function resolveTemplatesBase(): Promise<string> {
  const repo = process.env.NDJC_TEMPLATES_REPO;          // e.g. https://github.com/you/Packaging-warehouse.git
  const ref  = process.env.NDJC_TEMPLATES_REF || 'main'; // 分支 / Tag / Commit

  if (repo) {
    const rootBase = '/tmp/ndjc-templates';
    const root = path.join(rootBase, ref.replace(/[^\w.-]/g, '_'));
    await fs.mkdir(rootBase, { recursive: true });

    if (!existsSync(root)) {
      await exec('git', ['clone', '--depth', '1', '--branch', ref, repo, root]);
    } else {
      // 拉最新
      await exec('git', ['-C', root, 'fetch', 'origin', ref, '--depth', '1']);
      // 对齐远端 HEAD
      // 兼容 tag/commit：尽量 reset 到 FETCH_HEAD；失败再尝试 origin/<ref>
      try {
        await exec('git', ['-C', root, 'reset', '--hard', 'FETCH_HEAD']);
      } catch {
        await exec('git', ['-C', root, 'reset', '--hard', `origin/${ref}`]);
      }
      // 清理未跟踪文件，保持纯净
      await exec('git', ['-C', root, 'clean', '-fdx']);
    }
    // 远端仓库中模板根：要求与本地一致为 /templates
    return path.join(root, 'templates');
  }

  // 本地回退：仍然支持用仓库自带 templates 目录
  return process.env.TEMPLATES_DIR || path.join(process.cwd(), 'templates');
}
const TEMPLATE_DIR = { simple: 'simple-template', core: 'core-template', form: 'form-template' } as const;
async function templateRootAsync(t: keyof typeof TEMPLATE_DIR) {
  const base = await resolveTemplatesBase();
  return path.join(base, TEMPLATE_DIR[t]);
}
// 工作区（可写），Vercel 上默认 /tmp（可用 NDJC_WORKDIR 覆盖）
function workRepoRoot() {
  return process.env.NDJC_WORKDIR || '/tmp/ndjc';
}
// 仓库根（含 app/ 与 requests/）
function repoRoot() {
  return process.cwd();
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

/* ========= locales_config.xml（单数：locale_config.xml）=========
   注意：文件名改成 locale_config.xml，并与 Manifest 的
   android:localeConfig="@xml/locale_config" 保持一致。 */
async function writeLocalesConfig(appRoot: string, localesList?: string) {
  const list = (localesList || '').trim();
  if (!list) return;
  const items = list.split(',').map(s => s.trim()).filter(Boolean);
  if (!items.length) return;

  const xml =
`<locale-config xmlns:android="http://schemas.android.com/apk/res/android">
${items.map(l => `  <locale android:name="${l}"/>`).join('\n')}
</locale-config>
`;
  const dir = path.join(appRoot, 'src/main/res/xml');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'locale_config.xml'), xml, 'utf8');
}

/* ========= resConfigs -> Gradle ========= */
function toGradleResConfigs(list?: string): string {
  const raw = (list || '').trim();
  if (!raw) return '';
  const items = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!items.length) return '';
  const quoted = items.map(v => `'${v}'`).join(', ');
  return `resConfigs ${quoted}`;
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

  // Manifest localeConfig（支持 block 与 text 两种锚点）
  const LOCALE_CONFIG_ATTR = (o.resConfigs || '').trim() ? 'android:localeConfig="@xml/locale_config"' : '';

  const SIGNING_CONFIG = 'signingConfig signingConfigs.release';

  return [
    // strings.xml（锚点替换）
    {
      file: path.join(appRoot, 'src/main/res/values/strings.xml'),
      replace: [
        { marker: 'NDJC:APP_LABEL',   value: o.appName },
        { marker: 'NDJC:HOME_TITLE',  value: o.homeTitle },
        { marker: 'NDJC:MAIN_BUTTON', value: o.mainButtonText },
      ],
    },
    // Manifest（锚点替换）
    {
      file: path.join(appRoot, 'src/main/AndroidManifest.xml'),
      replace: [
        { marker: 'NDJC:APP_LABEL', value: o.appName },
        { marker: 'NDJC:LOCALE_CONFIG',        value: LOCALE_CONFIG_ATTR }, // 兼容旧锚点
        { marker: 'NDJC:BLOCK:LOCALE_CONFIG',  value: LOCALE_CONFIG_ATTR }, // 新 block 锚点
        { marker: 'NDJC:BLOCK:PERMISSIONS',    value: o.permissionsXml ?? '' },
        { marker: 'NDJC:BLOCK:INTENT_FILTERS', value: o.intentFiltersXml ?? '' },
      ],
    },
    // build.gradle / .kts（锚点替换）
    {
      file: gradleFile,
      replace: [
        { marker: 'NDJC:PACKAGE_NAME',         value: o.packageId },
        { marker: 'NDJC:COMPILE_SDK',          value: COMPILE_SDK },
        { marker: 'NDJC:MIN_SDK',              value: MIN_SDK },
        { marker: 'NDJC:TARGET_SDK',           value: TARGET_SDK },
        { marker: 'NDJC:VERSION_CODE',         value: VERSION_CODE },
        { marker: 'NDJC:VERSION_NAME',         value: VERSION_NAME },
        { marker: 'NDJC:PLUGINS_EXTRA',        value: PLUGINS_EXTRA },
        { marker: 'NDJC:DEPENDENCIES_EXTRA',   value: DEPENDENCIES_EXTRA },
        { marker: 'NDJC:SIGNING_CONFIG',       value: SIGNING_CONFIG },   // 可选
        { marker: 'NDJC:RES_CONFIGS',          value: RES_CONFIGS },
        { marker: 'NDJC:PROGUARD_FILES_EXTRA', value: PROGUARD_EXTRA },
        { marker: 'NDJC:PACKAGING_RULES',      value: PACKAGING_RULES },
      ],
    },
    // themes 覆盖块
    {
      file: path.join(appRoot, 'src/main/res/values/themes.xml'),
      replace: [{ marker: 'NDJC:BLOCK:THEME_OVERRIDES', value: o.themeOverridesXml ?? '' }],
    },
    // MainActivity 文案（Compose 里也保留锚点替换）
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

      if (marker.startsWith('NDJC:BLOCK:')) {
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

/* ========= 目录复制 ========= */
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

// 兜底：清理夜间主题目录，避免引用旧色值导致 AAPT 失败
async function purgeNightValues(appRoot: string) {
  const resDir = path.join(appRoot, 'src/main/res');
  try {
    const list = await fs.readdir(resDir, { withFileTypes: true });
    for (const it of list) {
      if (it.isDirectory() && it.name.startsWith('values-night')) {
        await fs.rm(path.join(resDir, it.name), { recursive: true, force: true });
      }
    }
  } catch {
    /* ignore */
  }
}

/** 强制每次运行都先清空工作目录再 materialize（总是使用最新模板） */
export async function materializeToWorkspace(templateKey: 'simple' | 'core' | 'form') {
  const repo = workRepoRoot();
  const srcApp = path.join(await templateRootAsync(templateKey), 'app');
  const dstApp = path.join(repo, 'app');

  // 清空工作目录
  await fs.rm(repo, { recursive: true, force: true });
  await fs.mkdir(repo, { recursive: true });

  await copyDir(srcApp, dstApp);
  await purgeNightValues(dstApp);
  return { dstApp, templateKey };
}

/* ========= 清理标记（anchors） ========= */
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
/** ✅ 保留导出：供 route.ts 引用 */
export async function cleanupAnchors(appRoot?: string) {
  const base = appRoot ?? path.join(workRepoRoot(), 'app');
  await walkAndStrip(base);
}

/* ========= 稳态化（防御式）修复 ========= */
export async function stabilizeGradle(appRoot: string) {
  const gradleFile = pickGradleFile(appRoot);
  let txt = await fs.readFile(gradleFile, 'utf8');
  const before = txt;

  // 0) 统一换行 + 去 BOM
  txt = txt.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  // 1) 修 android {{ / }} 多花括号
  txt = txt.replace(/android\s*\{\s*\{/g, 'android {');
  txt = txt.replace(/\}\s*\}/g, '}');

  // 2) plugins 未闭合则在 android 之前补 }
  {
    const idxPlugins = txt.indexOf('plugins');
    const idxAndroid = txt.indexOf('android');
    if (idxPlugins >= 0 && idxAndroid > idxPlugins) {
      const head = txt.slice(idxPlugins, idxAndroid);
      const open = (head.match(/\{/g) || []).length;
      const close = (head.match(/\}/g) || []).length;
      if (open > close) {
        txt = txt.slice(0, idxAndroid).replace(/\s*$/, '\n}\n') + txt.slice(idxAndroid);
      }
    }
  }

  // 3) 反注释 resConfigs
  txt = txt.replace(/^\s*\/\/\s*(resConfigs\b[^\n]*)/gm, '$1');

  // 4) 清理 NDJC 残留标记
  txt = txt.replace(/"NDJC:[^"]*"/g, '""').replace(/NDJC:[^\s<>"']+/g, '');

  // 5) 保证 android { 在独立行
  txt = txt.replace(/\n\s*android\s*\{/, '\nandroid {');

  // 6) 收尾
  txt = txt.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');

  if (txt !== before) await fs.writeFile(gradleFile, txt, 'utf8');
}

/* ========= 伴生文件入口 ========= */
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
export async function generateAndSync(
  o: NdjcOrchestratorOutput,
  templateKey: 'simple' | 'core' | 'form',
) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const reqDir = path.join(repoRoot(), 'requests', ts);

  // 1) 清空工作区并 materialize（总是最新模板）
  const { dstApp } = await materializeToWorkspace(templateKey);

  // 2) 构建计划 & 应用
  const plan = buildPlan(o);
  const detail = await applyPlanDetailed(plan);

  // 3) 伴生文件 + 清理标记 + 稳态修复
  await ensureAuxFiles(o);
  await cleanupAnchors();
  await stabilizeGradle(path.join(workRepoRoot(), 'app'));

  // 4) 写日志
  await writeJson(path.join(reqDir, '01_materialize.json'), { templateKey, dstApp });
  await writeJson(path.join(reqDir, '02_plan.json'), plan);
  await writeJson(path.join(reqDir, '03_apply_result.json'), detail);

  // 5) 关键锚点计数，0 则中止（阻断空包）
  const KEY = [
    'NDJC:PACKAGE_NAME', 'NDJC:APP_LABEL', 'NDJC:HOME_TITLE',
    'NDJC:MAIN_BUTTON', 'NDJC:BLOCK:PERMISSIONS', 'NDJC:BLOCK:INTENT_FILTERS'
  ];
  const replacedCount = countReplacements(detail, KEY);
  if (replacedCount === 0) {
    throw new Error('[NDJC] No critical anchors replaced (0) — abort to prevent empty APK.');
  }

  // 6) 写回 ./app
  await syncBackAppToRepo();

  // 7) 返回提交清单
  const commitPaths = [
    'app/**',
    `requests/${ts}/01_materialize.json`,
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
