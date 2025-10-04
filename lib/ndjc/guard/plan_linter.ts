/**
 * NDJC Plan Linter (single-file)
 * 用于对 requests/<runId>/02_plan.json 做“硬校验”：
 * - companions 禁止 .kt/.java（除非显式允许）
 * - BLOCK:* 仅允许“可执行语句”（不允许 package/import/顶层声明）
 * - HOOK:KOTLIN_IMPORTS 仅允许 import 行
 * - HOOK:KOTLIN_TOPLEVEL 仅允许“顶层声明”（fun/class/object/interface/data/typealias/val/var/const）
 * - 关键字段完整性：meta.template / meta.packageId / gradle.applicationId
 *
 * 产物：
 * - requests/<runId>/plan-violations.json
 * 退出码：
 * - 0：通过（无关键违例）
 * - 2：存在“关键违例”且 NDJC_FAIL_CLOSE=true
 */

import fs from "node:fs";
import path from "node:path";

type Dict<T = any> = Record<string, T>;

interface NdjcPlanV1 {
  meta: {
    runId?: string;
    template: string;
    appName: string;
    packageId: string;
    mode?: "A" | "B";
  };
  text?: Dict<string>;
  block?: Dict<string>;
  lists?: Dict<string[]>;
  if?: Dict<boolean | string | number>;
  resources?: Dict<string>;
  hooks?: Dict<string[] | string>;
  gradle?: {
    applicationId?: string;
    resConfigs?: string[];
    permissions?: string[];
    compileSdk?: number | null;
    minSdk?: number | null;
    targetSdk?: number | null;
    dependencies?: { group: string; name: string; version?: string | null; scope: string }[];
    proguardExtra?: string[];
  };
  companions?: { path: string; content: string; encoding?: "utf8" | "base64" }[];
}

interface Violation {
  id: string;                 // e.g. V-BLOCK-IMPORT
  severity: "critical" | "warning";
  anchor?: string;            // e.g. BLOCK:ENTRY_CALLS / HOOK:KOTLIN_IMPORTS
  where?: string;             // e.g. meta.template / companions[0].path
  reason: string;             // human readable
  sample?: string[];          // first few lines
}

const FAIL_CLOSE = (process.env.NDJC_FAIL_CLOSE || "true").toLowerCase() === "true";
const ALLOW_COMPANION_CODE = (process.env.NDJC_ALLOW_COMPANION_CODE || "false").toLowerCase() === "true";

function readJson<T = any>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function writeJson(p: string, obj: any) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function lines(s: string | string[] | undefined): string[] {
  if (!s) return [];
  if (Array.isArray(s)) return s.join("\n").split(/\r?\n/);
  return String(s).split(/\r?\n/);
}

function hasTopLevelDecl(s: string): boolean {
  return /^\s*(?:@Composable\s+)?fun\s|\bclass\s|\bobject\s|\binterface\s|\bdata\s+class\s|\btypealias\s|\bconst\s+val\s|\b(val|var)\s+\w+\s*[:=]/m.test(s);
}
function hasImport(s: string): boolean {
  return /^\s*import\s+[\w.]/m.test(s);
}
function hasPackage(s: string): boolean {
  return /^\s*package\s+[\w.]/m.test(s);
}
function onlyImports(arr: string[]): boolean {
  return arr.length > 0 && arr.every(l => /^\s*import\s+[\w.]/.test(l.trim()) || l.trim() === "");
}
function onlyTopLevel(arr: string[]): boolean {
  const src = arr.join("\n");
  if (hasImport(src) || hasPackage(src)) return false;
  // 必须至少有一个顶层声明，并且不包含明显的可执行语句块起始（简单判定）
  return hasTopLevelDecl(src);
}

function firstLines(s: string | string[], n = 6): string[] {
  return lines(s).slice(0, n);
}

function pushViolation(
  vs: Violation[],
  v: Partial<Violation> & Pick<Violation, "id" | "severity" | "reason">
) {
  vs.push(v as Violation);
}

function lintPlan(plan: NdjcPlanV1): { violations: Violation[]; critical: boolean } {
  const violations: Violation[] = [];

  // 0) 基本字段
  if (!plan.meta?.template) {
    pushViolation(violations, { id: "V-META-TEMPLATE-MISSING", severity: "critical", where: "meta.template", reason: "meta.template 缺失" });
  }
  if (!plan.meta?.packageId) {
    pushViolation(violations, { id: "V-META-PACKAGEID-MISSING", severity: "critical", where: "meta.packageId", reason: "meta.packageId 缺失" });
  }
  if (!plan.gradle?.applicationId) {
    pushViolation(violations, { id: "V-GRADLE-APPID-MISSING", severity: "critical", where: "gradle.applicationId", reason: "gradle.applicationId 缺失" });
  }

  // 1) companions 禁源码
  if (Array.isArray(plan.companions)) {
    for (const [i, f] of plan.companions.entries()) {
      const p = (f.path || "").toLowerCase();
      if ((p.endsWith(".kt") || p.endsWith(".java")) && !ALLOW_COMPANION_CODE) {
        pushViolation(violations, {
          id: "V-COMPANION-SOURCE-FORBIDDEN",
          severity: "critical",
          where: `companions[${i}].path`,
          reason: "companions 不允许包含源码文件（.kt/.java）",
          sample: firstLines(f.content || "", 4),
        });
      }
    }
  }

  // 2) BLOCK:* 仅“语句” —— 不允许 package/import/顶层声明
  for (const [k, v] of Object.entries(plan.block || {})) {
    const src = String(v || "");
    if (hasPackage(src)) {
      pushViolation(violations, { id: "V-BLOCK-PACKAGE", severity: "critical", anchor: k, reason: "BLOCK 中出现 package 声明", sample: firstLines(src) });
    }
    if (hasImport(src)) {
      pushViolation(violations, { id: "V-BLOCK-IMPORT", severity: "critical", anchor: k, reason: "BLOCK 中出现 import，必须走 HOOK:KOTLIN_IMPORTS", sample: firstLines(src) });
    }
    if (hasTopLevelDecl(src)) {
      pushViolation(violations, { id: "V-BLOCK-TOPLEVEL", severity: "critical", anchor: k, reason: "BLOCK 中出现顶层声明，必须走 HOOK:KOTLIN_TOPLEVEL", sample: firstLines(src) });
    }
  }

  // 3) HOOK:KOTLIN_IMPORTS 仅 import 行
  const hooks = plan.hooks || {};
  const hImports = hooks["HOOK:KOTLIN_IMPORTS"];
  if (hImports) {
    const arr = Array.isArray(hImports) ? hImports.flatMap(lines) : lines(hImports);
    if (!onlyImports(arr)) {
      pushViolation(violations, { id: "V-HOOK-IMPORTS-CONTENT", severity: "critical", anchor: "HOOK:KOTLIN_IMPORTS", reason: "HOOK:KOTLIN_IMPORTS 仅允许 import 行", sample: firstLines(arr, 8) });
    }
  }

  // 4) HOOK:KOTLIN_TOPLEVEL 仅顶层声明
  const hTop = hooks["HOOK:KOTLIN_TOPLEVEL"];
  if (hTop) {
    const arr = Array.isArray(hTop) ? hTop.flatMap(lines) : lines(hTop);
    if (!onlyTopLevel(arr)) {
      pushViolation(violations, { id: "V-HOOK-TOPLEVEL-CONTENT", severity: "critical", anchor: "HOOK:KOTLIN_TOPLEVEL", reason: "HOOK:KOTLIN_TOPLEVEL 仅允许顶层声明", sample: firstLines(arr, 10) });
    }
  }

  const critical = violations.some(v => v.severity === "critical");
  return { violations, critical };
}

function main() {
  const planPath = process.argv.find(a => a.startsWith("--plan="))?.split("=")[1]
    || process.env.PLAN_JSON
    || process.argv[2];

  if (!planPath) {
    console.error("usage: node plan_linter.ts --plan=requests/<runId>/02_plan.json");
    process.exit(1);
  }

  const plan: NdjcPlanV1 = readJson(planPath);
  const { violations, critical } = lintPlan(plan);

  const runId = plan.meta?.runId || process.env.RUN_ID || "unknown-run";
  const outDir = path.join(path.dirname(path.dirname(planPath)), path.basename(path.dirname(planPath)));
  const reqDir = path.dirname(planPath);
  const outFile = path.join(reqDir, "plan-violations.json");

  writeJson(outFile, {
    runId,
    total: violations.length,
    critical: violations.filter(v => v.severity === "critical").length,
    warnings: violations.filter(v => v.severity === "warning").length,
    violations,
    generatedAt: new Date().toISOString(),
  });

  console.log(`[NDJC][Linter] violations=${violations.length} critical=${critical ? "yes" : "no"} out=${outFile}`);

  if (critical && FAIL_CLOSE) {
    process.exit(2);
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}
