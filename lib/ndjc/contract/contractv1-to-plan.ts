import type { ContractV1 } from "./types";

/** 你的 generator 期望的 plan 形状（与 buildPlan(o) 输出对齐） */
export interface NdjcPlanV1 {
  meta: {
    runId?: string;
    template: string;
    appName: string;
    packageId: string;
    mode: "A" | "B";
  };
  text: Record<string, string>;
  block: Record<string, string>;
  list: Record<string, string[]>;
  if: Record<string, boolean>;
  gradle: {
    applicationId: string;
    resConfigs?: string[];
    permissions?: string[];
    compileSdk?: number;
    minSdk?: number;
    targetSdk?: number;
    dependencies?: { group: string; name: string; version?: string | null; scope: string }[];
    proguardExtra?: string[];
  };
  /** 可选：给 generator 额外提示要落盘的伴生文件（若你沿用旧 companions 机制，可忽略） */
  companions?: { path: string; content: string; encoding?: "utf8" | "base64" }[];
}

/** 将 Contract v1 的 JSON 直接映射为现有 generator 可消费的 plan 结构 */
export function contractV1ToPlan(doc: ContractV1): NdjcPlanV1 {
  const pkg = doc.metadata.packageId;
  // 1) 组装 gradle 合集
  const g = doc.anchors.gradle || ({} as any);
  const gradle = {
    applicationId: g.applicationId || pkg,
    resConfigs: g.resConfigs || doc.patches.gradle.resConfigs || [],
    permissions: g.permissions || doc.patches.manifest.permissions || [],
    compileSdk: doc.patches.gradle.compileSdk,
    minSdk: doc.patches.gradle.minSdk,
    targetSdk: doc.patches.gradle.targetSdk,
    dependencies: doc.patches.gradle.dependencies,
    proguardExtra: doc.patches.gradle.proguardExtra,
  };

  // 2) anchors 的四类直接映射
  const text = { ...(doc.anchors.text || {}) };
  const block = { ...(doc.anchors.block || {}) };
  const list  = { ...(doc.anchors.list  || {}) };
  const iff   = { ...(doc.anchors.if    || {}) };

  // 3) 一致性兜底：确保关键文本锚点与 metadata 一致
  if (!text["NDJC:PACKAGE_NAME"]) text["NDJC:PACKAGE_NAME"] = pkg;
  if (!text["NDJC:APP_LABEL"])    text["NDJC:APP_LABEL"]    = doc.metadata.appName;

  // 4) companions（仅 B 模式）：把 files 映射成 generator 可写入的 companions（若保持旧机制）
  const companions = (doc.metadata.mode === "B")
    ? doc.files.filter(f => f.kind !== "manifest_patch").map(f => ({
        path: f.path,
        content: f.content,
        encoding: f.encoding
      }))
    : [];

  return {
    meta: {
      runId: doc.metadata.runId,
      template: doc.metadata.template,
      appName: doc.metadata.appName,
      packageId: pkg,
      mode: doc.metadata.mode,
    },
    text,
    block,
    list,
    if: iff,
    gradle,
    companions,
  };
}
