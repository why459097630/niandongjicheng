import fs from "node:fs";
import path from "node:path";
import { Plan } from "../types";

export interface ApplyChange { file: string; marker: string; found: boolean; replacedCount: number; }
export interface ApplyResult { changes: ApplyChange[]; }

function replaceInFile(p: string, marker: string, value: string): ApplyChange {
  const text = fs.readFileSync(p, "utf8");
  const replaced = text.includes(marker) ? text.replaceAll(marker, value) : text;
  if (replaced !== text) fs.writeFileSync(p, replaced, "utf8");
  return { file: p, marker, found: text.includes(marker), replacedCount: replaced === text ? 0 : 1 };
}

export function applyAnchors(appDir: string, plan: Plan): ApplyResult {
  const res: ApplyResult = { changes: [] };
  const files = [
    path.join(appDir, "src/main/res/values/strings.xml"),
    path.join(appDir, "src/main/AndroidManifest.xml"),
    path.join(process.cwd(), "app", "build.gradle"), // 若模板 build.gradle 在 app/ 下，外部调用时传正确路径
  ].filter(fs.existsSync);

  for (const [marker, value] of Object.entries(plan.anchors)) {
    if (!value) continue;
    for (const f of files) res.changes.push(replaceInFile(f, marker, value));
  }
  return res;
}
