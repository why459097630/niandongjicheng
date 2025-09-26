// server/orchestrator/ir.ts
export type Strategy = "write" | "append" | "replace_file" | "replace_range";

export interface Companion {
  path_template: string;           // 例如: app/src/main/assets/ndjc/seed.json 或 app/src/main/java/{{PKG_PATH}}/data/SeedRepository.kt
  kind?: "json" | "kotlin" | "java" | "text";
  strategy: Strategy;
  markers?: { begin: string; end: string }; // 仅 replace_range 需要
  content: string;                  // 直接提供最终要落盘的内容（已渲染变量）
}

export interface PlanVars {
  packageId: string;                // com.niutao.canteen
  PKG_PATH: string;                 // com/niutao/canteen
  APP_DIR: string;                  // app
}

export interface Plan {
  mode: "A" | "B";
  template: string;                 // circle-basic 等
  anchors: Record<string, string>;  // 锚点键值
  vars: PlanVars;
  companions: Companion[];          // B 模式下的伴生写入清单
}
