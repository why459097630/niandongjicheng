import fs from "node:fs";
import path from "node:path";

export function writeSummary(repoRoot: string, runId: string, args: {
  branch: string; variant?: string; apk?: string;
  errors?: { classes?: string[]; notes?: string };
  anchors?: { missing_text: number; missing_block: number };
  snapshots?: { pre?: string; post?: string };
}) {
  const p = path.join(repoRoot, "requests", runId, "summary.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({
    runId, ...args, generated_at: new Date().toISOString()
  }, null, 2));
}
