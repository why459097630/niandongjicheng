// lib/ndjc/contract/contractv1-to-plan.ts
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
  /** 注意：下游读取的是 lists（复数） */
  lists: Record<string, string[]>;
  if: Record<string, boolean>;
  gradle: {
    applicationId: string;
    resConfigs?: string[];
    permissions?: string[];
    compileSdk?: number | null;
    minSdk?: number | null;
    targetSdk?: number | null;
    dependencies?: { group: string; name: string; version?: string | null; scope: string }[];
    proguardExtra?: string[];
  };
  /** 仅 B 模式：给 generator 可选写入的伴生文件 */
  companions?: { path: string; content: string; encoding?: "utf8" | "base64" }[];
}

/** 将 Contract v1 的 JSON 直接映射为现有 generator 可消费的 plan 结构 */
export function contractV1ToPlan(doc: ContractV1): NdjcPlanV1 {
  const pkg = doc.metadata.packageId;

  // 1) 组装 gradle 合集（把 null/undefined 归一到安全默认）
  const g = (doc.anchors.gradle || ({} as any));
  const gradle = {
    applicationId: g.applicationId || pkg,
    resConfigs: (g.resConfigs || doc.patches.gradle.resConfigs || []) ?? [],
    permissions: (g.permissions || doc.patches.manifest.permissions || []) ?? [],
    compileSdk: doc.patches.gradle.compileSdk ?? null,
    minSdk: doc.patches.gradle.minSdk ?? null,
    targetSdk: doc.patches.gradle.targetSdk ?? null,
    dependencies: doc.patches.gradle.dependencies ?? [],
    proguardExtra: doc.patches.gradle.proguardExtra ?? [],
  };

  // 2) anchors 的四类映射（lists 用复数；并统一兜底为 {} / []）
  const text  = { ...(doc.anchors.text  || {}) };
  const block = { ...(doc.anchors.block || {}) };
  const lists = { ...(doc.anchors.list  || {}) } as Record<string, string[]>;
  const iff   = { ...(doc.anchors.if    || {}) };

  // 3) 关键文本锚点与 metadata 对齐（防止 LLM 漏掉导致构建失败）
  if (!text["NDJC:PACKAGE_NAME"]) text["NDJC:PACKAGE_NAME"] = pkg;
  if (!text["NDJC:APP_LABEL"])    text["NDJC:APP_LABEL"]    = doc.metadata.appName;

  // 4) companions（仅 B 模式）：把 files 映射成写入项
  const companions =
    doc.metadata.mode === "B"
      ? (doc.files || []).filter(f => f.kind !== "manifest_patch").map(f => ({
          path: f.path,
          content: f.content,
          encoding: f.encoding || "utf8",
        }))
      : [];

  return {
    meta: {
      runId: doc.metadata.runId ?? undefined,
      template: doc.metadata.template,
      appName: doc.metadata.appName,
      packageId: pkg,
      mode: doc.metadata.mode,
    },
    text,
    block,
    lists,           // 👈 复数
    if: iff,
    gradle,
    companions,
  };
}
