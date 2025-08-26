// lib/ndjc/generator.ts

/**
 * 生成计划中单个文件的编辑描述
 * - mode = "patch"   : 传入 unified diff 文本（git apply 可用）
 * - mode = "create"  : 直接创建新文件，可用 content 或 contentBase64
 */
export type FileEdit = {
  path: string;
  mode: "patch" | "create";
  patch?: string;
  content?: string;
  contentBase64?: string;
};

/**
 * generatePlan 入参：新增 template 字段（可选）
 */
export interface GeneratePlanOptions {
  prompt: string;
  appName: string;
  packageName: string;
  template?: string; // ✅ 新增：允许从前端传模板名（core-template / form-template / simple-template）
}

/**
 * 生成计划（返回给 route.ts，用于写入 requests/*.json 并提交 patch）
 */
export interface NdjcPlan {
  appName: string;
  packageName: string;
  template?: string;
  files: FileEdit[];
  // 你也可以在此扩展 meta / steps / modelOutput 等信息，便于审计
  meta?: Record<string, any>;
}

/**
 * 生成“差量计划”
 * 目前提供一个最小可用实现：返回空的 files，保证端到端流程先跑通。
 * 之后你只要根据 template 在这里往 files 里 push 对应的补丁就可以了。
 */
export async function generatePlan(opts: GeneratePlanOptions): Promise<NdjcPlan> {
  const { prompt, appName, packageName, template } = opts;

  // TODO: 在这里把 GROQ 的 JSON 结果转换为差量补丁（files）
  // 例如：
  // if (template === "form-template") {
  //   files.push({
  //     path: "app/src/main/java/com/example/app/MainActivity.java",
  //     mode: "patch",
  //     patch: `*** 这里放 unified diff ***`,
  //   });
  // } else if (template === "core-template") {
  //   ...
  // }

  const files: FileEdit[] = [];

  // 先返回一个最小计划，确保 route.ts -> github-writer 整条链路可编译执行
  const plan: NdjcPlan = {
    appName,
    packageName,
    template,
    files,
    meta: {
      // 这些只是为了后续排查方便，可删
      promptSnippet: prompt.slice(0, 120),
      generatedAt: new Date().toISOString(),
    },
  };

  return plan;
}
