// server/orchestrator/buildPlan.ts
import { Plan } from "./ir";

export function buildPlanA(params: any): Plan { /* 保持你现有逻辑 */ }

export function buildPlanB(params: any): Plan {
  const packageId = params.packageId;                 // com.niutao.canteen
  const PKG_PATH  = packageId.replace(/\./g, "/");    // com/niutao/canteen
  const APP_DIR   = "app";

  // 1) 从 LLM/前端得到 lists（若没有，也给出最小合法 JSON）
  const posts = Array.isArray(params.lists?.posts) ? params.lists.posts : [];

  const seedJson = JSON.stringify({ posts }, null, 2);

  // 2) companions：固定写入 seed.json；（可选）同时支持替换 SeedRepository.kt 块
  const companions = [
    {
      path_template: `${APP_DIR}/src/main/assets/ndjc/seed.json`,
      kind: "json",
      strategy: "write",
      content: seedJson,
    },
    // 备选：若你采用代码块替换方式
    // {
    //   path_template: `${APP_DIR}/src/main/java/{{PKG_PATH}}/data/SeedRepository.kt`,
    //   kind: "kotlin",
    //   strategy: "replace_range",
    //   markers: { begin: "// NDJC:SEED_POSTS_BEGIN", end: "// NDJC:SEED_POSTS_END" },
    //   content: renderKotlinList(posts),
    // },
  ];

  return {
    mode: "B",
    template: params.template,
    anchors: params.anchors ?? {},
    vars: { packageId, PKG_PATH, APP_DIR },
    companions
  };
}
