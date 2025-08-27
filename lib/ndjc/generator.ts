// lib/ndjc/generator.ts

/**
 * 说明：
 * 1) 本文件负责将前端入参(或上游 LLM / GROQ JSON)转换为“计划(plan)”
 * 2) 计划包含 files[]，每个文件是一条差量补丁（极简：整文件替换）
 * 3) 先用 README.md 作为最小提交，打通提交链路；后续把更多文件补丁 append 进去即可
 */

export type FileEdit = {
  /**
   * 仓库内的相对路径（例如 "README.md"、"app/src/main/java/..."）
   */
  path: string;

  /**
   * contentBase64 或 patch 二选一：
   * - contentBase64：以 base64 字符串传递“整个文件内容”
   * - patch：这里先用“整文件内容”的明文方式（上层会直接覆盖写入）
   *
   * 生产可升级为真正 diff（unified patch）再在上层应用。
   */
  contentBase64?: string;
  patch?: string;

  /**
   * 自定义元信息（非必须），便于后续在 requests/*.json 中回溯
   */
  meta?: Record<string, any>;
};

export type GeneratePlanArgs = {
  prompt: string;
  appName?: string;
  packageName?: string;
  template?: string; // e.g. "form-template" | "simple-template" | "core-template"
  // 如果你把 GROQ 的返回 JSON 传进来，可以加 groq / spec 字段
  // groq?: any;
};

export type Plan = {
  appName: string;
  packageName: string;
  template: string;
  files: FileEdit[];
  // 预留：把原始 prompt / spec 也放到 plan，方便写 requests/* 归档
  prompt?: string;
  spec?: any;
};

function normalizeAppName(name?: string) {
  const v = (name || "MyApp").trim();
  return v.length ? v : "MyApp";
}

function normalizePackageName(pkg?: string) {
  // 简单兜底：不合法就回退到 com.example.app
  const fallback = "com.example.app";
  if (!pkg) return fallback;
  const ok = /^[a-zA-Z]+[a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(pkg);
  return ok ? pkg : fallback;
}

function normalizeTemplate(tpl?: string) {
  return tpl || "form-template";
}

/**
 * 将 inputs 构造成差量补丁（目前最小化：只生成 README.md 替换）
 * 你可以在这里把 GROQ 的 JSON 映射到更多文件：
 * - 例如：生成 Java/Kotlin 源文件、XML 布局、strings.xml、图标等
 * - 每个文件 push 一个 FileEdit
 */
function buildEdits(plan: Plan): FileEdit[] {
  const lines: string[] = [];
  lines.push(`# ${plan.appName}`);
  lines.push("");
  lines.push("本应用由 **NDJC 生成器** 自动生成。");
  lines.push("");
  lines.push("## 需求 (prompt)");
  lines.push("");
  lines.push(plan.prompt || "(未提供)"); // 归档一下
  lines.push("");
  lines.push("## 模板信息");
  lines.push("");
  lines.push(`- 模板（template）：\`${plan.template}\``);
  lines.push(`- 包名（packageName）：\`${plan.packageName}\``);
  lines.push("");

  const readmePatch = lines.join("\n");

  const edits: FileEdit[] = [
    {
      path: "README.md",
      patch: readmePatch,
      meta: { reason: "ndjc-minimal-readme" },
    },
  ];

  // === 后续扩展在这里追加 ===
  // 例如：
  // edits.push({
  //   path: "app/src/main/res/layout/activity_main.xml",
  //   patch: buildActivityXmlFromSpec(plan.spec),
  //   meta: { anchorBased: true }
  // });

  return edits;
}

/**
 * 主函数：生成“计划”
 */
export async function generatePlan(args: GeneratePlanArgs): Promise<Plan> {
  const plan: Plan = {
    appName: normalizeAppName(args.appName),
    packageName: normalizePackageName(args.packageName),
    template: normalizeTemplate(args.template),
    files: [],
    prompt: args.prompt || "",
    spec: undefined, // 如果已拿到 GROQ 的 JSON，可塞入此处，写入 requests 归档
  };

  // 目前：最小可用 —— 只生成 README.md 的替换补丁
  plan.files = buildEdits(plan);

  return plan;
}
