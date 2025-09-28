import type { ContractV1 } from "../contract/types";
import {
  REQUIRED_TEXT_ANCHORS,
  REQUIRED_BLOCK_ANCHORS,
  REQUIRED_LIST_ANCHORS,
} from "../constants/contract";

/** 校验结果项 */
type Issue = { code: string; message: string; path?: string };
type Result = { ok: boolean; issues: Issue[] };

/**
 * 语义层 Lint：
 * - 校验模式与内容是否匹配（A 模式不能带 files，B 模式建议带最小 files）
 * - 校验模板级必备锚点（文本/块/列表）
 * - 对列表类锚点缺失给出空数组兜底，避免生成器失败
 */
export function lintContract(doc: ContractV1): Result {
  const issues: Issue[] = [];

  // 1) 模式约束
  if (doc.metadata.mode === "A" && doc.files.length !== 0) {
    issues.push({
      code: "E_MODE_A_FILES",
      message: "mode A requires files=[]",
      path: "files"
    });
  }
  if (doc.metadata.mode === "B" && doc.files.length === 0) {
    issues.push({
      code: "E_MODE_B_EMPTY",
      message: "mode B should provide minimal files",
      path: "files"
    });
  }

  // 2) 文本锚点（如 PACKAGE_NAME / APP_LABEL）
  for (const key of REQUIRED_TEXT_ANCHORS) {
    const v = doc.anchors.text?.[key];
    if (typeof v !== "string" || v.length === 0) {
      const code = key.includes("PACKAGE_NAME")
        ? "E_TEXT_PACKAGE_NAME"
        : key.includes("APP_LABEL")
        ? "E_TEXT_APP_LABEL"
        : "E_TEXT_MISSING";
      issues.push({
        code,
        message: `missing text anchor: ${key}`,
        path: `anchors.text.${key}`
      });
    }
  }

  // 3) 块锚点（如 HOME_BODY / SCREEN_CONTENT）
  for (const key of REQUIRED_BLOCK_ANCHORS) {
    const v = doc.anchors.block?.[key];
    if (typeof v !== "string" || v.length === 0) {
      const code = key.endsWith("SCREEN_CONTENT")
        ? "E_SCREEN_CONTENT"
        : "E_BLOCK_HOME_BODY";
      issues.push({
        code,
        message: `missing block anchor: ${key}`,
        path: `anchors.block.${key}`
      });
    }
  }

  // 4) 列表锚点（如 PROGUARD_EXTRA / PACKAGING_RULES）
  for (const key of REQUIRED_LIST_ANCHORS) {
    const exists = !!doc.anchors.list && Object.prototype.hasOwnProperty.call(doc.anchors.list, key);
    if (!exists) {
      if (!doc.anchors.list) (doc.anchors.list as any) = {};
      (doc.anchors.list as any)[key] = [];
      issues.push({
        code: "W_LIST_MISSING_FILLED",
        message: `list anchor missing, filled []: ${key}`,
        path: `anchors.list.${key}`
      });
    }
  }

  // 5) SCREEN_CONTENT 强制存在（即使模板清单未列出时的兜底）
  if (!doc.anchors.block || typeof doc.anchors.block["NDJC:BLOCK:SCREEN_CONTENT"] !== "string") {
    issues.push({
      code: "E_SCREEN_CONTENT",
      message: "anchors.block.NDJC:BLOCK:SCREEN_CONTENT required",
      path: "anchors.block.NDJC:BLOCK:SCREEN_CONTENT"
    });
  }

  // 6) 结果
  const hasErrors = issues.some(i => i.code.startsWith("E_"));
  return { ok: !hasErrors, issues };
}
