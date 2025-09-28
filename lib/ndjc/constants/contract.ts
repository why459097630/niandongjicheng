// lib/ndjc/constants/contract.ts
// ========== 既有：必备锚点清单 ==========
export type RequiredAnchors = { text: string[]; block: string[]; list: string[] };

export const REQUIRED_CIRCLE_BASIC: RequiredAnchors = {
  text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE", "NDJC:PRIMARY_BUTTON_TEXT"],
  block: ["NDJC:BLOCK:HOME_BODY", "NDJC:BLOCK:SCREEN_CONTENT"],
  list: ["LIST:PROGUARD_EXTRA", "LIST:PACKAGING_RULES", "LIST:ROUTES"],
};

export const REQUIRED_FLOW_BASIC: RequiredAnchors = {
  text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE"],
  block: ["NDJC:BLOCK:SCREEN_CONTENT"],
  list: ["LIST:PROGUARD_EXTRA", "LIST:PACKAGING_RULES", "LIST:ROUTES"],
};

export const REQUIRED_MAP_BASIC: RequiredAnchors = {
  text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE"],
  block: ["NDJC:BLOCK:SCREEN_CONTENT"],
  list: ["LIST:PROGUARD_EXTRA", "LIST:PACKAGING_RULES", "LIST:ROUTES"],
};

export const REQUIRED_SHOP_BASIC: RequiredAnchors = {
  text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE"],
  block: ["NDJC:BLOCK:SCREEN_CONTENT"],
  list: ["LIST:PROGUARD_EXTRA", "LIST:PACKAGING_RULES", "LIST:ROUTES"],
};

export const REQUIRED_SHOWCASE_BASIC: RequiredAnchors = {
  text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE"],
  block: ["NDJC:BLOCK:SCREEN_CONTENT"],
  list: ["LIST:PROGUARD_EXTRA", "LIST:PACKAGING_RULES"],
};

export const TEMPLATE_REQUIRED: Record<string, RequiredAnchors> = {
  "circle-basic": REQUIRED_CIRCLE_BASIC,
  "flow-basic": REQUIRED_FLOW_BASIC,
  "map-basic": REQUIRED_MAP_BASIC,
  "shop-basic": REQUIRED_SHOP_BASIC,
  "showcase-basic": REQUIRED_SHOWCASE_BASIC,
};

export function requiredForTemplate(t?: string): RequiredAnchors {
  return TEMPLATE_REQUIRED[String(t || "").toLowerCase()] || REQUIRED_CIRCLE_BASIC;
}

// 兼容旧引用（现阶段默认用 circle-basic）
export const REQUIRED_TEXT_ANCHORS  = REQUIRED_CIRCLE_BASIC.text;
export const REQUIRED_BLOCK_ANCHORS = REQUIRED_CIRCLE_BASIC.block;
export const REQUIRED_LIST_ANCHORS  = REQUIRED_CIRCLE_BASIC.list;

// ========== 新增：限额 / 白名单 / 规则 / 安全正则 ==========

// 文字锚点总字节上限（防止超大 prompt 注入）
export const MAX_ANCHORS_TEXT_BYTES = 16 * 1024; // 16KB

// 推荐的 package id 前缀（供 lint/limits 使用）
export const PACKAGE_ID_PREFIX = "app.ndjc." as const;

// 允许的文件种类（契约 files[*].kind）
export const ALLOWED_FILE_KINDS = [
  "source",          // Kotlin 源
  "values",          // res/values
  "drawable",        // res/drawable
  "raw",             // res/raw
  "manifest_patch",  // 清单补丁
] as const;

// 禁止生成 layout 目录（我们只支持 Compose）
export const FORBID_LAYOUT_DIR = "app/src/main/res/layout";

// 路径规则（供 path-rules.ts 使用的简化版）
export const PATH_RULES = {
  // 允许写入的前缀（相对仓库模板根）
  allowPrefixes: [
    "app/src/main/java/",
    "app/src/main/kotlin/",
    "app/src/main/res/values/",
    "app/src/main/res/drawable/",
    "app/src/main/res/raw/",
  ],
  // 禁止路径（前缀匹配）
  denyPrefixes: [
    FORBID_LAYOUT_DIR + "/",
    "app/src/androidTest/",
    "app/src/test/",
    "gradle/",
    ".github/",
  ],
};

// 危险权限（最小化策略：如确需使用应通过 if 条件与人工审核）
export const FORBIDDEN_PERMISSIONS = [
  "android.permission.READ_SMS",
  "android.permission.SEND_SMS",
  "android.permission.RECEIVE_SMS",
  "android.permission.READ_PHONE_STATE",
  "android.permission.CALL_PHONE",
  "android.permission.PROCESS_OUTGOING_CALLS",
  "android.permission.RECORD_AUDIO", // 默认禁用，避免越权
  "android.permission.WRITE_SETTINGS",
  "android.permission.SYSTEM_ALERT_WINDOW",
];

// 硬编码网络/反射/动态加载/命令执行等危险模式
export const HARD_IP_REGEX   = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/;
export const HARD_URL_REGEX  = /\bhttps?:\/\/(?!localhost|127\.0\.0\.1)[^\s"'`]+/i;
export const REFLECTION_REGEX = /\b(?:Class\.forName|kotlin\.reflect|java\.lang\.reflect)\b/;
export const DYNAMIC_LOAD_REGEX = /\b(?:DexClassLoader|PathClassLoader|System\.loadLibrary)\b/;
export const SCRIPT_EXEC_REGEX  = /\b(?:Runtime\.getRuntime\(\)\.exec|ProcessBuilder\s*\()\b/;
