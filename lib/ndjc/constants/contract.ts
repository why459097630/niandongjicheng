export const CONTRACT_VERSION = "1.0.0" as const;
export const MAX_FILES_DEFAULT = 50;
export const MAX_FILE_KB_DEFAULT = 300;
export const MAX_ANCHORS_TEXT_BYTES = 50 * 1024;

export const ALLOWED_FILE_KINDS = ["source", "values", "drawable", "raw", "manifest_patch"] as const;
export const ALLOWED_SCOPES = [
  "implementation", "api", "kapt", "ksp", "testImplementation", "androidTestImplementation"
] as const;

export const FORBIDDEN_PERMISSIONS = new Set<string>([
  "android.permission.READ_SMS",
  "android.permission.SEND_SMS",
  "android.permission.RECEIVE_WAP_PUSH",
  "android.permission.RECEIVE_MMS",
  "android.permission.RECORD_AUDIO",
  "android.permission.CAMERA",
  "android.permission.WRITE_SETTINGS",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.REQUEST_INSTALL_PACKAGES"
]);

export const PATH_RULES = {
  source: /^app\/src\/main\/java\/[A-Za-z0-9_\/]+\/[A-Za-z0-9_]+\.kt$/,
  values: /^app\/src\/main\/res\/values\/[A-Za-z0-9_.-]+\.xml$/,
  drawable: /^app\/src\/main\/res\/drawable\/[A-Za-z0-9_.-]+\.(xml|png|webp)$/,
  raw: /^app\/src\/main\/res\/raw\/[A-Za-z0-9_.-]+$/
};

export const FORBID_LAYOUT_DIR = /app\/src\/main\/res\/layout\//;
export const PACKAGE_ID_PREFIX = /^app\.ndjc\./;
export const HARD_IP_REGEX = /\b((25[0-5]|2[0-4]\d|[0-1]?\d?\d)(\.(?=\d)|$)){4}\b/;
export const HARD_URL_REGEX = /https?:\/\//i;
export const REFLECTION_REGEX = /Class\s*\.forName|java\.lang\.reflect/;
export const DYNAMIC_LOAD_REGEX = /DexClassLoader|PathClassLoader/;
export const SCRIPT_EXEC_REGEX = /Runtime\.getRuntime\(\)\.exec|ProcessBuilder\(/;

// —— 必备锚点（circle-basic 最小集，可扩展到其它模板）——
export const REQUIRED_TEXT_ANCHORS = [
  "NDJC:PACKAGE_NAME",
  "NDJC:APP_LABEL"
];
export const REQUIRED_BLOCK_ANCHORS = [
  "NDJC:BLOCK:HOME_BODY",
  "NDJC:BLOCK:SCREEN_CONTENT"
];
export const REQUIRED_LIST_ANCHORS = [
  "LIST:PROGUARD_EXTRA",
  "LIST:PACKAGING_RULES"
];
