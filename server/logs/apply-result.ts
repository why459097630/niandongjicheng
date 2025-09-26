import fs from "node:fs";
import path from "node:path";
import { ApplyResult } from "../materialize/anchors";

export function writeApplyResult(repoRoot: string, runId: string, r: ApplyResult) {
  const p = path.join(repoRoot, "requests", runId, "03_apply_result.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(r, null, 2));
}
