// lib/ndjc/generator.ts
// 统一默认值（兜底，用户没填时也能打包）
export const defaults: Record<string, any> = {
  // 基础
  NDJC_APP_NAME: "MyApp",
  NDJC_PACKAGE_ID: "com.example.myapp",
  NDJC_VERSION_NAME: "1.0.0",
  NDJC_VERSION_CODE: 1,
  NDJC_MIN_SDK: 24,
  NDJC_TARGET_SDK: 34,
  NDJC_APP_DESCRIPTION: "",
  NDJC_LOCALE_DEFAULT: "en",

  // 主题/品牌（Material3）
  NDJC_PRIMARY_COLOR: "#6750A4",
  NDJC_SECONDARY_COLOR: "#625B71",
  NDJC_ACCENT_COLOR: "#7D5260",
  NDJC_THEME_MODE: "system", // system|light|dark
  NDJC_FONT_FAMILY: "sans-serif",
  NDJC_SPLASH_BG_COLOR: "#FFFFFF",
  NDJC_CORNER_RADIUS_DP: 12,
  NDJC_ELEVATION_DP: 2,
  NDJC_ENABLE_MATERIAL3: true,

  // 权限/网络
  NDJC_PERMISSIONS: [],
  NDJC_FEATURES: [],
  NDJC_ALLOW_CLEAR_TEXT: false,
  NDJC_BASE_URL: "",
  NDJC_API_ENDPOINTS: [],
  NDJC_API_HEADERS_JSON: "{}",
  NDJC_API_TIMEOUT_MS: 15000,

  // 页面/文案（simple）
  NDJC_MAIN_ACTIVITY: "MainActivity",
  NDJC_HOME_TITLE: "Home",
  NDJC_ACTION_PRIMARY_TEXT: "OK",
  NDJC_ACTION_SECONDARY_TEXT: "Cancel",

  // 图标（含AI）
  NDJC_APP_ICON_PNG: "", // 若用户上传PNG，填路径/URL；否则留空
  NDJC_APP_ICON_BG_COLOR: "#121212",
  NDJC_APP_ICON_PADDING: 0.10,
  NDJC_APP_ICON_MONOCHROME_PNG: "",
  NDJC_APP_ICON_STRATEGY: "auto",   // auto|upload|emoji|glyph|text
  NDJC_APP_ICON_PROMPT: "",
  NDJC_APP_ICON_GEN_PROVIDER: "none", // none|openai|stability|sdxl|replicate
  NDJC_APP_ICON_GEN_STYLE: "flat",
  NDJC_APP_ICON_SHAPE: "squircle",
  NDJC_APP_ICON_SIZE: 1024,
  NDJC_APP_ICON_NEG_PROMPT: "text, watermark, photo, busy background",
  NDJC_APP_ICON_STEPS: 30,
  NDJC_APP_ICON_GUIDANCE: 6.5,
  NDJC_APP_ICON_SEED: 0,

  // CI/产物
  NDJC_WORKFLOW_APP_ID: "ndjc",
  NDJC_BUILD_VARIANT: "release",
  NDJC_BUILD_FLAVOR: "none",
  NDJC_MINIFY_ENABLED: false,
  NDJC_ARTIFACT_NAME: "app-release.apk",
  NDJC_RELEASE_TAG: "v1.0.0",
  NDJC_RELEASE_NAME: "Release v1.0.0",
  NDJC_RELEASE_BODY: "",
  NDJC_CHANGELOG: "",
  NDJC_ANCHOR_SET_VERSION: "1.0"
};

// 将用户输入与默认值合并（从不缺字段）
export function resolveWithDefaults(input: Record<string, any>) {
  const merged: Record<string, any> = {};
  for (const k of Object.keys(defaults)) merged[k] = input[k] ?? defaults[k];
  return merged;
}

// 条件注入：支持 {{#NDJC_FOO}}...{{/NDJC_FOO}} 与 {{NDJC_FOO}}
export function injectConditionalBlocks(content: string, params: Record<string, any>) {
  const truthy = (v: any) => v === true || v === "true" || (typeof v === "number" && v > 0);
  // 块条件
  content = content.replace(/{{#(NDJC_[A-Z0-9_]+)}}([\s\S]*?){{\/\1}}/g, (_, key, block) =>
    truthy(params[key]) ? block : ""
  );
  // 单值替换
  content = content.replace(/{{(NDJC_[A-Z0-9_]+)}}/g, (_, key) =>
    String(params[key] ?? "")
  );
  return content;
}

// 写文件的工具（示例，按你项目现有的写入函数替换）
import * as fs from "fs";
export function write(path: string, data: string) {
  fs.mkdirSync(require("path").dirname(path), { recursive: true });
  fs.writeFileSync(path, data);
}

// ——（可选）规则图标SVG（兜底）——
export function makeLetterIconSVG(text: string, bg: string, fg: string) {
  const t = (text || "APP").slice(0, 2).toUpperCase();
  return `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="1024" rx="200" fill="${bg}"/>
  <text x="50%" y="55%" text-anchor="middle"
        font-family="Inter, system-ui, Roboto, Helvetica, Arial, sans-serif"
        font-size="560" font-weight="800" fill="${fg}">
    ${t}
  </text>
</svg>`.trim();
}

// 入口：把锚点应用到 simple-template
export function applyAnchorsToSimpleTemplate(params: Record<string, any>, rootDir: string) {
  const p = resolveWithDefaults(params);

  // 1) 基本资源：app_name、colors（图标背景与主题色）
  write(`${rootDir}/app/src/main/res/values/strings.xml`,
`<resources>
  <string name="app_name">${p.NDJC_APP_NAME}</string>
  <string name="title_home">${p.NDJC_HOME_TITLE}</string>
  <string name="action_primary">${p.NDJC_ACTION_PRIMARY_TEXT}</string>
  <string name="action_secondary">${p.NDJC_ACTION_SECONDARY_TEXT}</string>
</resources>`);

  write(`${rootDir}/app/src/main/res/values/colors.xml`,
`<resources>
  <color name="ic_launcher_background">${p.NDJC_APP_ICON_BG_COLOR}</color>
</resources>`);

  // 2) 生成兜底 SVG（若用户未上传PNG、也未启用AI）
  // 始终保证有 app/icon.svg（CI 会把它转成前景PNG）
  const initials = (p.NDJC_APP_NAME || "APP").trim().split(/\s+/).map((s: string)=>s[0]).join("").slice(0,2);
  write(`${rootDir}/app/icon.svg`, makeLetterIconSVG(initials, p.NDJC_APP_ICON_BG_COLOR, "#FFFFFF"));
}
