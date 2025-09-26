export type Mode = "A" | "B";

export interface Anchors {
  "NDJC:APP_LABEL"?: string;
  "NDJC:HOME_TITLE"?: string;
  "NDJC:PRIMARY_BUTTON_TEXT"?: string;
  "NDJC:MAIN_BUTTON"?: string;
  "NDJC:PACKAGE_NAME"?: string;
}

export interface CompanionFile {
  path: string;      // 相对仓库根，如: app/src/main/java/...
  kind: "kotlin" | "xml" | "raw" | "gradle";
  content: string;   // 直接文本
  overwrite?: boolean;
}

export interface Plan {
  runId: string;
  template_key: string;
  mode: Mode;              // A/B
  anchors: Anchors;
  lists?: Record<string, unknown>;     // 可见数据(JSON)
  blocks?: Record<string, unknown>;
  companions?: CompanionFile[];
}
