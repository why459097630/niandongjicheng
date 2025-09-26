// server/materialize/anchors.ts
import fs from "node:fs";
import path from "node:path";
import { Plan } from "../types";

export interface ApplyChange {
  file: string;
  marker: string;
  found: boolean;
  replacedCount: number;
}
export interface ApplyResult {
  changes: ApplyChange[];
}

/** 兼容实现：用 split/join 代替 replaceAll，并返回实际替换次数 */
function replaceInFile(p: string, marker: string, value: string): ApplyChange {
  const text = fs.readFileSync(p, "utf8");

  let replaced = text;
  let count = 0;

  if (marker && text.includes(marker)) {
    const parts = text.split(marker);
    count = parts.length - 1;          // 实际替换次数
    replaced = parts.join(value);
  }

  if (replaced !== text) fs.writeFileSync(p, replaced, "utf8");
  return { file: p, marker, found: count > 0, replacedCount: count };
}

export function applyAnchors(appDir: string, plan: Plan): ApplyResult {
  const res: ApplyResult = { changes: [] };

  // 参与替换的文件（存在即生效）
  const files = [
    path.join(appDir, "src/main/res/values/strings.xml"),
    path.join(appDir, "src/main/AndroidManifest.xml"),
    path.join(appDir, "build.gradle"),
    path.join(appDir, "build.gradle.kts"),
    // 兜底：有些模板放在仓库根 app/ 下
    path.join(process.cwd(), "app", "build.gradle"),
    path.join(process.cwd(), "app", "build.gradle.kts"),
  ].filter(fs.existsSync);

  for (const [marker, value] of Object.entries(plan.anchors || {})) {
    for (const f of files) {
      res.changes.push(replaceInFile(f, marker, value ?? ""));
    }
  }
  return res;
}
