// lib/ndjc/generator.ts
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { NdjcOrchestratorOutput, ApplyResult, AnchorChange } from './types';

// =============== 关键路径策略 ===============
// 读模板：代码包内只读目录（可通过 TEMPLATES_DIR 覆盖）
function templatesBase() {
  return process.env.TEMPLATES_DIR || path.join(process.cwd(), 'templates');
}

// 写工作区：Vercel 可写盘 /tmp（可通过 NDJC_WORKDIR 覆盖）
function workRepoRoot() {
  return process.env.NDJC_WORKDIR || '/tmp/ndjc';
}

// ===========================================
const TEMPLATE_DIR = {
  simple: 'simple-template',
  core: 'core-template',
  form: 'form-template',
} as const;

function templateRoot(t: keyof typeof TEMPLATE_DIR) {
  return path.join(templatesBase(), TEMPLATE_DIR[t]);
}

// app 根下优先 .kts
function pickGradleFile(appRoot: string) {
  const kts = path.join(appRoot, 'build.gradle.kts');
  const groovy = path.join(appRoot, 'build.gradle');
  return existsSync(kts) ? kts : groovy;
}

type Patch = { file: string; replace: Array<{ marker: string; value: string }> };

// 生成 locales_config.xml（由 resConfigs 推导）
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
  await fs.writeFile(path.join(dir, 'locales_config.xml'), xml, 'utf8');
}

export function buildPlan(o: NdjcOrchestratorOutput): Patch[] {
  const repo = workRepoRoot();               // <- 工作区根
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

  // 可选字段从 orchestrator 输出读取；若没有则为空串即可
  const RES_CONFIGS = (o.resConfigs ?? '').trim();

  // ✅ 把 "en, zh-CN" 转成 "'en', 'zh-CN'"（Gradle/Groovy 或 Kotlin DSL 都能接受）
  const RES_CONFIGS_GRADLE = RES_CONFIGS
    ? RES_CONFIGS.split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => `'${s.replace(/'/g, "\\'")}'`)
        .join(', ')
    : '';

  const PROGUARD_EXTRA     = o.proguardExtra ?? '';
  const PACKAGING_RULES    = o.packagingRules ?? '';

  // 只要 resConfigs 非空，就在 Manifest 上挂 localeConfig
  const LOCALE_CONFIG_ATTR = (RES_CONFIGS.length > 0)
    ? 'android:localeConfig="@xml/locales_config"'
    : '';

  // 是否真正生效取决于模板 signingConfigs 是否存在
  const SIGNING_CONFIG     = 'signingConfig signingConfigs.release';

  return [
    // strings.xml：三处必选 UI 文案
    {
      file: path.join(appRoot, 'src/main/res/values/strings.xml'),
      replace: [
        { marker: 'NDJC:APP_LABEL',   value: o.appName },
        { marker: 'NDJC:HOME_TITLE',  value: o.homeTitle },
        { marker: 'NDJC:MAIN_BUTTON', value: o.mainButtonText },
      ],
    },
    // Manifest：应用名 + 可选 localeConfig 属性 + 两个 BLOCK 注入点
    {
      file: path.join(appRoot, 'src/main/AndroidManifest.xml'),
      replace: [
        { marker: 'NDJC:APP_LABEL', value: o.appName },
        { marker: 'NDJC:LOCALE_CONFIG', value: LOCALE_CONFIG_ATTR },
        { marker: 'BLOCK:PERMISSIONS', value: o.permissionsXml ?? '' },
        { marker: 'BLOCK:INTENT_FILTERS', value: o.intentFiltersXml ?? '' },
      ],
    },
    // Gradle：版本/签名/额外规则/多语言
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
        { marker: 'NDJC:SIGNING_CONFIG',       value: SIGNING_CONFIG },
        // ✅ 用已格式化的 Gradle 形态
        { marker: 'NDJC:RES_CONFIGS',          value: RES_CONFIGS_GRADLE },
        { marker: 'NDJC:PROGUARD_FILES_EXTRA', value: PROGUARD_EXTRA },
        { marker: 'NDJC:PACKAGING_RULES',      value: PACKAGING_RULES },
      ],
    },
    // 主题覆盖块
    {
      file: path.join(appRoot, 'src/main/res/values/themes.xml'),
      replace: [
        { marker: 'BLOCK:THEME_OVERRIDES', value: o.themeOverridesXml ?? '' },
      ],
    },
    // 主页按钮/标题（若有）
    {
      file: path.join(appRoot, 'src/main/java/com/ndjc/app/MainActivity.kt'),
      replace: [
        { marker: 'NDJC:HOME_TITLE',  value: o.homeTitle },
        { marker: 'NDJC:MAIN_BUTTON', value: o.mainButtonText },
      ],
    },
  ];
}

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
        // 替换整个注释节点：<!-- BLOCK:XXX --> 或 <!-- //BLOCK:XXX -->
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
        // 普通 NDJC:XXX 字面替换
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

export async function materializeToWorkspace(templateKey: 'simple' | 'core' | 'form') {
  const repo = workRepoRoot();                 // <- 写入工作区
  const srcApp = path.join(templateRoot(templateKey), 'app');   // <- 读模板
  const dstApp = path.join(repo, 'app');
  await fs.mkdir(repo, { recursive: true });   // 确保工作区存在
  await fs.rm(dstApp, { recursive: true, force: true });
  await copyDir(srcApp, dstApp);
  return { dstApp };
}

/* ---------- 最终剥离 NDJC/BLOCK 标记 ---------- */

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
  txt = txt.replace(/[ \t]+$/gm, '');
  txt = txt.replace(/\n{3,}/g, '\n\n');
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

// ✅ 可选参数：可传入 appRoot，也可不传（默认工作区 app）
export async function cleanupAnchors(appRoot?: string) {
  const base = appRoot ?? path.join(workRepoRoot(), 'app');
  await walkAndStrip(base);
}

/* ---------- 伴生文件入口（API 调用） ---------- */
export async function ensureAuxFiles(o: NdjcOrchestratorOutput) {
  const appRoot = path.join(workRepoRoot(), 'app');  // <- 工作区
  // 仅当 resConfigs 非空时生成 locales_config.xml
  if ((o.resConfigs ?? '').trim()) {
    await writeLocalesConfig(appRoot, o.resConfigs);
  }
}
