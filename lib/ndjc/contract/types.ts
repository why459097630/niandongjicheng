// lib/ndjc/contract/types.ts

/** LLM 合同里 file.kind 的受限枚举 */
export type FileKind =
  | "source"          // Kotlin 源码：app/src/main/java|kotlin/...
  | "values"          // res/values/ 下的 xml/json 等配置（不生成布局）
  | "drawable"        // res/drawable/ 受限资源（占位图等）
  | "raw"             // res/raw/ 额外数据（如 seed json）
  | "manifest_patch"; // AndroidManifest 片段（如果走文件通道）

export type Mode = "A" | "B";

export interface ContractV1 {
  metadata: {
    runId?: string | null;
    mode: Mode;
    template: string;
    appName: string;
    packageId: string;
    locales: string[];
    summary?: string | null;
    constraints?: {
      maxFiles?: number;
      maxFileKB?: number;
      allowNetwork?: boolean;
      [k: string]: unknown;
    };
    meta?: {
      entry_activity?: string;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };

  patches: {
    gradle: {
      compileSdk?: number | null;
      minSdk?: number | null;
      targetSdk?: number | null;
      resConfigs?: string[] | null;
      proguardExtra?: string[] | null;
      dependencies?: Array<{
        group: string;
        name: string;
        version?: string | null;
        scope: string; // implementation / api / debugImplementation ...
      }> | null;
      [k: string]: unknown;
    };
    manifest: {
      permissions?: string[];
      [k: string]: unknown;
    };
  };

  files: Array<{
    path: string;                 // 相对 app 根，如 app/src/main/java/...
    kind: FileKind;               // 👈 改为使用上面的枚举
    encoding?: "utf8" | "base64";
    content: string;
    overwrite?: boolean | null;
  }>;

  anchors: {
    text:   Record<string, string>;
    block:  Record<string, string>;
    list:   Record<string, string[]>;
    if:     Record<string, boolean>;
    gradle: {
      applicationId: string;
      resConfigs?: string[] | null;
      permissions?: string[] | null;
      [k: string]: unknown;
    };
  };
}
