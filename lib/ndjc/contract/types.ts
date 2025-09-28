// lib/ndjc/contract/types.ts

/** 与 ndjc-android-contract-v1.schema.json 对齐的最小 TypeScript 类型 */

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
    path: string; // 相对 app 根，如 app/src/main/java/...
    kind: "source" | "values" | "drawable" | "raw" | "manifest_patch";
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
