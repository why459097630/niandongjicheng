// lib/ndjc/generator.ts
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { NdjcOrchestratorOutput, ApplyResult, AnchorChange } from './types';

/* ========= 路径策略 ========= */
function templatesBase() {
  return process.env.TEMPLATES_DIR || path.join(process.cwd(), 'templates');
}
function workRepoRoot() {
  return process.env.NDJC_WORKDIR || '/tmp/ndjc';
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

/* ========= locales_config.xml ========= */
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

/* ========= resConfigs 转换为 Gradle 正确写法 ========= */
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

  const LOCALE_CONFIG_ATTR = (o.resConfigs || '').trim() ? 'android:localeConfig="@xml/locales_config"' : '';
  const SIGNING_CONFIG = 'signingConfig signingConfigs.release';

  return [
    // strings.xml（注意：apply 时会自动扩展到所有 values*/strings.xml）
    {
      file: path.join(appRoot, 'src/main/res/values/strings.xml'),
      replace: [
        { marker: 'NDJC:APP_LABEL',   value: o.appName },
        { marker: 'NDJC:HOME_TITLE',  value: o.homeTitle },
        { marker: 'NDJC:MAIN_BUTTON', value: o.mainButtonText },
      ],
    },
    // Manifest
    {
      file: path.join(appRoot, 'src/main/AndroidManifest.xml'),
      replace: [
        { marker: 'NDJC:APP_LABEL', value: o.appName },
        { marker: 'NDJC:LOCALE_CONFIG', value: LOCALE_CONFIG_ATTR },
        { marker: 'BLOCK:PERMISSIONS', value: o.permissionsXml ?? '' },
        { marker: 'BLOCK:INTENT_FILTERS', value: o.intentFiltersXml ?? '' },
      ],
    },
    // build.gradle / .kts
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
        { marker: 'NDJC:RES_CONFIGS',          value: RES_CONFIGS },
        { marker: 'NDJC:PROGUARD_FILES_EXTRA', value: PROGUARD_EXTRA },
        { marker: 'NDJC:PACKAGING_RULES',      value: PACKAGING_RULES },
      ],
    },
    // themes 覆盖块
    {
      file: path.join(appRoot, 'src/main/res/values/themes.xml'),
      replace: [{ marker: 'BLOCK:THEME_OVERRIDES', value: o.themeOverridesXml ?? '' }],
    },
    // MainActivity 文案
    {
      file: path.join(appRoot, 'src/main/java/com/ndjc/app/MainActivity.kt'),
      replace: [
        { marker: 'NDJC:HOME_TITLE',  value: o.homeTitle },
        { marker: 'NDJC:MAIN_BUTTON', value: o.mainButtonText },
      ],
    },
  ];
}

/* ========= 辅助：展开 strings.xml 到所有 locale ========= */
function shouldExpandValuesStrings(p: string) {
  // 只在 app/src/main/res/values/strings.xml 触发扩展
  const norm = p.replace(/\\/g, '/');
  return /\/src\/main\/res\/values\/strings\.xml$/.test(norm);
}
async function expandLocaleStringTargets(primary: string): Promise<string[]> {
  if (!shouldExpandValuesStrings(primary)) return [primary];

  const resDir = path.dirname(path.dirname(primary)); // .../res
  let entries: string[];
  try {
    entries = await fs.readdir(resDir, { withFileTypes: true }).then(list => list.map(e => e.name));
  } catch {
    return [primary];
  }

  const candidates = entries
    .filter(n => n.startsWith('values'))             // values, values-zh-rCN, values-en, ...
    .map(n => path.join(resDir, n, 'strings.xml'));

  // 包含主文件 + 仅保留存在的
  const uniq = new Set<string>([primary, ...candidates]);
  const filtered: string[] = [];
  for (const f of uniq) {
    try {
      if (existsSync(f)) filtered.push(f);
    } catch { /* ignore */ }
  }
  return filtered;
}

/* ========= 应用计划（增强版：多 locale + fail-fast） ========= */
export async function applyPlanDetailed(plan: Patch[]): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];

  for (const p of plan) {
    // 1) 计算本 Patch 实际要处理的文件（strings.xml 会扩展到所有 values*）
    const targetFiles = await expandLocaleStringTargets(p.file);
    // 用于 fail-fast：统计每个 marker 是否至少在一个目标文件里被找到
    const markerFoundAny: Record<string, number> = Object.fromEntries(
      p.replace.map(r => [r.marker, 0]),
    );

    for (const file of targetFiles) {
      let txt = await fs.readFile(file, 'utf8');
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

        if (found) markerFoundAny[marker] = (markerFoundAny[marker] ?? 0) + replacedCount;
        changes.push({ file, marker, found, replacedCount, beforeSample, afterSample });
      }

      if (txt !== beforeAll) await fs.writeFile(file, txt, 'utf8');
      results.push({ file, changes });
    }

    // 2) fail-fast：如果某个 marker 在所有目标文件里都没被找到，则中断
    const missed = Object.entries(markerFoundAny)
      .filter(([, cnt]) => !cnt)
      .map(([m]) => m);
    if (missed.length) {
      throw new Error(
        `NDJC applyPlan: markers not found in any target file for "${p.file}": ${missed.join(', ')}`
      );
    }
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
export async function materializeToWorkspace(templateKey: 'simple' | 'core' | 'form') {
  const repo = workRepoRoot();
  const srcApp = path.join(templateRoot(templateKey), 'app');
  const dstApp = path.join(repo, 'app');
  await fs.mkdir(repo, { recursive: true });
  await fs.rm(dstApp, { recursive: true, force: true });
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

/* ========= 稳态化（防御式）修复 ========= */
export async function stabilizeGradle(appRoot: string) {
  const gradleFile = pickGradleFile(appRoot);
  let txt = await fs.readFile(gradleFile, 'utf8');
  const before = txt;

  txt = txt.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  txt = txt.replace(/android\s*\{\s*\{/g, 'android {');
  txt = txt.replace(/\}\s*\}/g, '}');

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

  txt = txt.replace(/^\s*\/\/\s*(resConfigs\b[^\n]*)/gm, '$1');
  txt = txt.replace(/"NDJC:[^"]*"/g, '""').replace(/NDJC:[^\s<>"']+/g, '');
  txt = txt.replace(/\n\s*android\s*\{/m, '\nandroid {');
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
