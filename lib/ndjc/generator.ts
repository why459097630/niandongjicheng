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
  return `resConfigs ${items.map(v => `'${v}'`).join(', ')}`;
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
  const LOCALE_CONFIG_ATTR = (o.resConfigs || '').trim()
    ? 'android:localeConfig="@xml/locales_config"' : '';
  const SIGNING_CONFIG = 'signingConfig signingConfigs.release';

  return [
    { file: path.join(appRoot, 'src/main/res/values/strings.xml'),
      replace: [
        { marker: 'NDJC:APP_LABEL',   value: o.appName },
        { marker: 'NDJC:HOME_TITLE',  value: o.homeTitle },
        { marker: 'NDJC:MAIN_BUTTON', value: o.mainButtonText },
      ],
    },
    { file: path.join(appRoot, 'src/main/AndroidManifest.xml'),
      replace: [
        { marker: 'NDJC:APP_LABEL', value: o.appName },
        { marker: 'NDJC:LOCALE_CONFIG', value: LOCALE_CONFIG_ATTR },
        { marker: 'BLOCK:PERMISSIONS', value: o.permissionsXml ?? '' },
        { marker: 'BLOCK:INTENT_FILTERS', value: o.intentFiltersXml ?? '' },
      ],
    },
    { file: gradleFile,
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
    { file: path.join(appRoot, 'src/main/res/values/themes.xml'),
      replace: [{ marker: 'BLOCK:THEME_OVERRIDES', value: o.themeOverridesXml ?? '' }],
    },
    { file: path.join(appRoot, 'src/main/java/com/ndjc/app/MainActivity.kt'),
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
          beforeSample = txt.slice(Math.max(0, m[0].index! - 40), Math.min(txt.length, m[0].index! + m[0][0].length + 40));
          txt = txt.replace(re, r.value ?? '');
          afterSample = txt;
        }
      } else {
        const idx = txt.indexOf(marker);
        if (idx >= 0) {
          found = true;
          const re = new RegExp(escape(marker), 'g');
          replacedCount = (txt.match(re) || []).length;
          txt = txt.replace(re, r.value ?? '');
          afterSample = txt;
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

export async function materializeToWorkspace(templateKey: 'simple' | 'core' | 'form') {
  const repo = workRepoRoot();
  // ✅ 强制清空整个工作区，确保是干净的
  await fs.rm(repo, { recursive: true, force: true });

  const srcApp = path.join(templateRoot(templateKey), 'app');
  const dstApp = path.join(repo, 'app');
  await fs.mkdir(repo, { recursive: true });
  await copyDir(srcApp, dstApp);
  return { dstApp };
}
