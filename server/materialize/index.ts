// server/materialize/index.ts
import { materializeAnchors } from "./materializeAnchors";
import { materializeCompanions } from "./materializeCompanions";
import type { Plan } from "../orchestrator/ir";

export async function materializeAll(repoRoot: string, plan: Plan, runDir: string) {
  // 1) 先跑锚点替换（你已有）
  await materializeAnchors(repoRoot, plan, runDir);
  // 2) 再跑 companions 合并（新增）
  materializeCompanions(repoRoot, plan, runDir);
}
