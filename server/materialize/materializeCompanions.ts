// server/materialize/materializeCompanions.ts
import fs from "fs";
import path from "path";
import type { Plan, Companion } from "../orchestrator/ir";

type WriteResult = {
  path: string;
  strategy: string;
  bytes: number;
  status: "write" | "append" | "replace" | "noop" | "skip" | "fail";
  reason?: string;
};

function renderPath(tpl: string, vars: Plan["vars"]) {
  return tpl
    .replace(/\{\{\s*PKG_PATH\s*\}\}/g, vars.PKG_PATH)
    .replace(/\{\{\s*APP_DIR\s*\}\}/g, vars.APP_DIR);
}

function secureJoin(root: string, rel: string) {
  const tgt = path.resolve(root, rel);
  if (!tgt.startsWith(path.resolve(root) + path.sep)) {
    throw new Error(`path_out_of_root: ${rel}`);
  }
  return tgt;
}

function normalizeKotlinPackage(content: string, packageId: string) {
  return content.replace(/package\s+([a-zA-Z0-9_.]+)/, `package ${packageId}`);
}

function replaceRange(original: string, begin: string, end: string, replacement: string) {
  const b = original.indexOf(begin);
  const e = original.indexOf(end);
  if (b === -1 || e === -1 || e < b) throw new Error("markers_not_found");
  const head = original.slice(0, b + begin.length) + "\n";
  const tail = "\n" + original.slice(e);
  return head + replacement + tail;
}

export function materializeCompanions(
  repoRoot: string,           // 已 checkout 的工作树根
  plan: Plan,
  runDir: string              // requests/<runId>/ 目录，用于记录日志
): WriteResult[] {
  const results: WriteResult[] = [];
  const logFile = path.join(runDir, "04_materialize.txt");
  let log = "";

  for (const c of plan.companions || []) {
    try {
      const rel = renderPath(c.path_template, plan.vars);
      if (!rel.startsWith(`${plan.vars.APP_DIR}/`)) {
        throw new Error(`target_must_under_APP_DIR: ${rel}`);
      }
      const abs = secureJoin(repoRoot, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });

      let payload = c.content ?? "";

      // Kotlin/Java 统一 package（仅内容层）
      if (c.kind === "kotlin" || c.kind === "java") {
        payload = normalizeKotlinPackage(payload, plan.vars.packageId);
      }

      if (c.strategy === "write" || c.strategy === "replace_file") {
        const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : null;
        if (before !== null && before === payload) {
          results.push({ path: rel, strategy: c.strategy, bytes: payload.length, status: "noop" });
          log += `NOOP ${rel}\n`;
        } else {
          fs.writeFileSync(abs, payload, "utf-8");
          results.push({ path: rel, strategy: c.strategy, bytes: payload.length, status: "write" });
          log += `WRITE ${rel}\n`;
        }
        continue;
      }

      if (c.strategy === "append") {
        fs.appendFileSync(abs, payload, "utf-8");
        results.push({ path: rel, strategy: c.strategy, bytes: payload.length, status: "append" });
        log += `APPEND ${rel}\n`;
        continue;
      }

      if (c.strategy === "replace_range") {
        const begin = c.markers?.begin ?? "";
        const end   = c.markers?.end ?? "";
        if (!fs.existsSync(abs)) throw new Error("target_missing_for_replace_range");
        const original = fs.readFileSync(abs, "utf-8");
        const next = replaceRange(original, begin, end, payload);
        if (next === original) {
          results.push({ path: rel, strategy: c.strategy, bytes: payload.length, status: "noop" });
          log += `NOOP ${rel}\n`;
        } else {
          fs.writeFileSync(abs, next, "utf-8");
          results.push({ path: rel, strategy: c.strategy, bytes: payload.length, status: "replace" });
          log += `REPLACE_RANGE ${rel}\n`;
        }
        continue;
      }

      results.push({ path: rel, strategy: c.strategy, bytes: payload.length, status: "skip", reason: "unknown_strategy" });
      log += `SKIP ${rel} (unknown_strategy)\n`;
    } catch (err: any) {
      results.push({ path: c.path_template, strategy: c.strategy, bytes: 0, status: "fail", reason: String(err?.message ?? err) });
      log += `FAIL ${c.path_template}: ${String(err?.message ?? err)}\n`;
    }
  }

  if (log) fs.appendFileSync(logFile, log);
  // 同时把结果写成机读结构
  const applyJson = path.join(runDir, "03_apply_result.json");
  try {
    const prev = fs.existsSync(applyJson) ? JSON.parse(fs.readFileSync(applyJson, "utf-8")) : {};
    prev.companions = results;
    fs.writeFileSync(applyJson, JSON.stringify(prev, null, 2));
  } catch { /* 忽略 */ }

  return results;
}
