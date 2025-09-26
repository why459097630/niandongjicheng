import fs from "node:fs";
import path from "node:path";
import { Plan } from "../types";

export function applyCompanions(repoRoot: string, plan: Plan) {
  for (const f of plan.companions ?? []) {
    const target = path.join(repoRoot, f.path);
    if (!target.startsWith(path.join(repoRoot, "app"))) throw new Error(`Out of app/: ${f.path}`);
    if (fs.existsSync(target) && !f.overwrite) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content, "utf8");
  }
}
