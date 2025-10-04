/**
 * NDJC Sanitizer (single-file)
 * 对 02_plan.json 做“注入前的消毒与归位”：
 * - 剥离所有片段中的 package
 * - 抽取 import → 去重 → 合并进 HOOK:KOTLIN_IMPORTS
 * - 若 BLOCK 中夹带 import/顶层声明：抽取到对应 HOOK（或标记 skipped）
 * - 输出：02_plan.sanitized.json（供后续 materialize 注入）
 */

import fs from "node:fs";
import path from "node:path";

type Dict<T = any> = Record<string, T>;

interface NdjcPlanV1 {
  meta: { runId?: string; template: string; appName: string; packageId: string; mode?: "A" | "B" };
  text?: Dict<string>;
  block?: Dict<string>;
  lists?: Dict<string[]>;
  if?: Dict<boolean | string | number>;
  resources?: Dict<string>;
  hooks?: Dict<string[] | string>;
  gradle?: any;
  companions?: { path: string; content: string; encoding?: "utf8" | "base64" }[];
}

function readJson<T = any>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(p: string, obj: any) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function splitLines(x: string | string[]): string[] {
  if (Array.isArray(x)) return x.flatMap(s => String(s).split(/\r?\n/));
  return String(x || "").split(/\r?\n/);
}
function stripPackage(src: string): string {
  return src.replace(/^\s*package\s+[\w.]+\s*[\r\n]/gm, "");
}
function extractImports(src: string): { body: string; imports: string[] } {
  const imps: string[] = [];
  const body = src
    .split(/\r?\n/)
    .filter(line => {
      const m = line.match(/^\s*import\s+([\w.]+\.*[\w*]*)\s*$/);
      if (m) { imps.push(line.trim()); return false; }
      return true;
    })
    .join("\n");
  return { body, imports: imps };
}
function uniqSorted(arr: string[]): string[] {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));
}
function hasTopLevelDecl(src: string): boolean {
  return /^\s*(?:@Composable\s+)?fun\s|\bclass\s|\bobject\s|\binterface\s|\bdata\s+class\s|\btypealias\s|\bconst\s+val\s|\b(val|var)\s+\w+\s*[:=]/m.test(src);
}

function sanitize(plan: NdjcPlanV1) {
  const hooks: Dict<string[]> = {};
  const existingHooks = plan.hooks || {};
  // seed existing hooks (normalize to array)
  for (const [k, v] of Object.entries(existingHooks)) {
    hooks[k] = Array.isArray(v) ? v.flatMap(splitLines) : splitLines(v);
  }
  const importsBucket = hooks["HOOK:KOTLIN_IMPORTS"] || [];

  const blockOut: Dict<string> = {};
  for (const [k, v] of Object.entries(plan.block || {})) {
    let src = String(v || "");
    src = stripPackage(src);
    const { body, imports } = extractImports(src);
    if (imports.length) importsBucket.push(...imports);

    // 如果 BLOCK 中仍包含“看起来是顶层声明”的内容，尽量移到 TOPLEVEL，否则保留
    if (hasTopLevelDecl(body)) {
      hooks["HOOK:KOTLIN_TOPLEVEL"] = (hooks["HOOK:KOTLIN_TOPLEVEL"] || []).concat(body);
      blockOut[k] = ""; // 留空，由生成器/脚本判定是否跳过
    } else {
      blockOut[k] = body;
    }
  }

  // 顶层 hook 消毒：剥 package、提取 import → 移入 imports
  if (hooks["HOOK:KOTLIN_TOPLEVEL"]) {
    const topSrc = hooks["HOOK:KOTLIN_TOPLEVEL"].join("\n");
    const stripped = stripPackage(topSrc);
    const { body, imports } = extractImports(stripped);
    hooks["HOOK:KOTLIN_TOPLEVEL"] = body.split(/\r?\n/);
    if (imports.length) importsBucket.push(...imports);
  }

  // imports 去重排序
  hooks["HOOK:KOTLIN_IMPORTS"] = uniqSorted(importsBucket);

  const sanitized: NdjcPlanV1 = {
    ...plan,
    block: blockOut,
    hooks,
  };
  return sanitized;
}

function main() {
  const planPath =
    process.argv.find(a => a.startsWith("--plan="))?.split("=")[1] ||
    process.env.PLAN_JSON ||
    process.argv[2];

  if (!planPath) {
    console.error("usage: node sanitize/index.ts --plan=requests/<runId>/02_plan.json");
    process.exit(1);
  }

  const plan: NdjcPlanV1 = readJson(planPath);
  const sanitized = sanitize(plan);

  const outPath = path.join(path.dirname(planPath), "02_plan.sanitized.json");
  writeJson(outPath, sanitized);

  console.log(`[NDJC][Sanitizer] in=${planPath} out=${outPath} hooks(imports)=${(sanitized.hooks?.["HOOK:KOTLIN_IMPORTS"] as string[] | undefined)?.length || 0}`);

  process.exit(0);
}

if (require.main === module) {
  main();
}
