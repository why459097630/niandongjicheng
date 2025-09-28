import type { ContractV1 } from "../contract/types";
import { REQUIRED_TEXT_ANCHORS, REQUIRED_BLOCK_ANCHORS, REQUIRED_LIST_ANCHORS } from "../constants/contract";

export function lintContract(doc: ContractV1) {
  const issues: { code: string; message: string; path?: string }[] = [];

  if (doc.metadata.mode === "A" && doc.files.length !== 0) {
    issues.push({ code: "E_MODE_A_FILES", message: "mode A requires files=[]", path: "files" });
  }
  if (doc.metadata.mode === "B" && doc.files.length === 0) {
    issues.push({ code: "E_MODE_B_EMPTY", message: "mode B should provide minimal files", path: "files" });
  }

  for (const key of REQUIRED_TEXT_ANCHORS) {
    if (!doc.anchors.text || typeof doc.anchors.text[key] !== "string" || doc.anchors.text[key].length === 0) {
      const code = key.includes("PACKAGE_NAME") ? "E_TEXT_PACKAGE_NAME" : "E_TEXT_APP_LABEL";
      issues.push({ code, message: `missing text anchor: ${key}`, path: `anchors.text.${key}` });
    }
  }

  for (const key of REQUIRED_BLOCK_ANCHORS) {
    if (!doc.anchors.block || typeof doc.anchors.block[key] !== "string" || doc.anchors.block[key].length === 0) {
      const code = key.endsWith("SCREEN_CONTENT") ? "E_SCREEN_CONTENT" : "E_BLOCK_HOME_BODY";
      issues.push({ code, message: `missing block anchor: ${key}`, path: `anchors.block.${key}` });
    }
  }

  for (const key of REQUIRED_LIST_ANCHORS) {
    const has = doc.anchors.list && Object.prototype.hasOwnProperty.call(doc.anchors.list, key);
    if (!has) {
      if (!doc.anchors.list) (doc.anchors.list as any) = {};
      (doc.anchors.list as any)[key] = [];
      issues.push({ code: "W_LIST_MISSING_FILLED", message: `list anchor missing, filled []: ${key}`, path: `anchors.list.${key}` });
    }
  }

  if (!doc.anchors.block || typeof doc.anchors.block["NDJC:BLOCK:SCREEN_CONTENT"] !== "string") {
    issues.push({ code: "E_SCREEN_CONTENT", message: "anchors.block.NDJC:BLOCK:SCREEN_CONTENT required", path: "anchors.block.NDJC:BLOCK:SCREEN_CONTENT" });
  }

  return { ok: issues.filter(i => i.code.startsWith("E_")).length === 0, issues };
}
