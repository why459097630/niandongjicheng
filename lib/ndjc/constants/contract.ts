// lib/ndjc/constants/contract.ts

/**
 * 必备锚点清单（presence-only）：
 * - 目的是避免 LLM 漏掉关键锚点导致注入/构建失败
 * - 允许空字符串/空数组作为占位；内容质量由后续校验与生成器决策
 */

export type RequiredAnchors = {
  text: string[];
  block: string[];
  list: string[];
  // 如需要求 if/gradle，可扩展此类型并在 lint 中接线
};

/** ============ circle-basic（社交流） ============ */
export const REQUIRED_CIRCLE_BASIC: RequiredAnchors = {
  text: [
    "NDJC:PACKAGE_NAME",
    "NDJC:APP_LABEL",
    "NDJC:HOME_TITLE",
    "NDJC:PRIMARY_BUTTON_TEXT",
  ],
  block: [
    "NDJC:BLOCK:HOME_BODY",
    "NDJC:BLOCK:SCREEN_CONTENT",
  ],
  list: [
    "LIST:PROGUARD_EXTRA",
    "LIST:PACKAGING_RULES",
    "LIST:ROUTES",
  ],
};

/** ============ flow-basic（多页面向导） ============ */
export const REQUIRED_FLOW_BASIC: RequiredAnchors = {
  text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE"],
  block: ["NDJC:BLOCK:SCREEN_CONTENT"],
  list: ["LIST:PROGUARD_EXTRA", "LIST:PACKAGING_RULES", "LIST:ROUTES"],
};

/** ============ map-basic（地图） ============ */
export const REQUIRED_MAP_BASIC: RequiredAnchors = {
  text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE"],
  block: ["NDJC:BLOCK:SCREEN_CONTENT"],
  list: ["LIST:PROGUARD_EXTRA", "LIST:PACKAGING_RULES", "LIST:ROUTES"],
};

/** ============ shop-basic（商品/购物车） ============ */
export const REQUIRED_SHOP_BASIC: RequiredAnchors = {
  text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE"],
  block: ["NDJC:BLOCK:SCREEN_CONTENT"],
  list: ["LIST:PROGUARD_EXTRA", "LIST:PACKAGING_RULES", "LIST:ROUTES"],
};

/** ============ showcase-basic（展示页） ============ */
export const REQUIRED_SHOWCASE_BASIC: RequiredAnchors = {
  text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE"],
  block: ["NDJC:BLOCK:SCREEN_CONTENT"],
  list: ["LIST:PROGUARD_EXTRA", "LIST:PACKAGING_RULES"],
};

/** 模板名到必备锚点集合的映射（小写键） */
export const TEMPLATE_REQUIRED: Record<string, RequiredAnchors> = {
  "circle-basic": REQUIRED_CIRCLE_BASIC,
  "flow-basic": REQUIRED_FLOW_BASIC,
  "map-basic": REQUIRED_MAP_BASIC,
  "shop-basic": REQUIRED_SHOP_BASIC,
  "showcase-basic": REQUIRED_SHOWCASE_BASIC,
};

/** 便捷函数：按模板获取必备锚点，未知模板回落到 circle-basic */
export function requiredForTemplate(template?: string): RequiredAnchors {
  const key = String(template || "").toLowerCase();
  return TEMPLATE_REQUIRED[key] || REQUIRED_CIRCLE_BASIC;
}

/**
 * 兼容旧引用：
 * - 现阶段默认使用 circle-basic 的必备集
 * - 若要按模板动态切换，请在使用处改为 requiredForTemplate(doc.metadata.template)
 */
export const REQUIRED_TEXT_ANCHORS  = REQUIRED_CIRCLE_BASIC.text;
export const REQUIRED_BLOCK_ANCHORS = REQUIRED_CIRCLE_BASIC.block;
export const REQUIRED_LIST_ANCHORS  = REQUIRED_CIRCLE_BASIC.list;
