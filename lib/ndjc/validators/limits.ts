// lib/ndjc/validators/limits.ts
import type { ContractV1 } from "../contract/types";
import { MAX_ANCHORS_TEXT_BYTES } from "../constants/contract";

type Issue = { code: string; message: string; path?: string };

// 计算 UTF-8 字节长度（在无 Buffer 环境降级到 TextEncoder）
function utf8ByteLen(s: string): number {
  if (typeof Buffer !== "undefined") return Buffer.byteLength(s ?? "", "utf8");
  // Node 18+ / Web 环境均有 TextEncoder
  return new TextEncoder().encode(s ?? "").length;
}

export function checkLimits(doc: ContractV1): { ok: boolean; issues: Issue[] } {
  const issues: Issue[] = [];

  // -------- constraints 兜底 --------
  const constraints = (doc as any)?.metadata?.constraints ?? {};
  const maxFiles =
    typeof constraints.maxFiles === "number" && constraints.maxFiles > 0
      ? constraints.maxFiles
      : null;
  const maxFileKB =
    typeof constraints.maxFileKB === "number" && constraints.maxFileKB > 0
      ? constraints.maxFileKB
      : null;

  // -------- 1) 文件数量上限 --------
  if (maxFiles !== null && Array.isArray(doc.files) && doc.files.length > maxFiles) {
    issues.push({
      code: "E_LIMITS_FILES",
      message: `files.length(${doc.files.length}) > ${maxFiles}`,
      path: "files",
    });
  }

  // -------- 2) 单文件大小上限（KB）--------
  if (maxFileKB !== null && Array.isArray(doc.files)) {
    for (const f of doc.files) {
      const content = f?.content ?? "";
      // base64 近似换算：每 4 字符 ≈ 3 字节（忽略 '=' padding 的微小误差）
      const approxBytes =
        (f?.encoding || "utf8") === "base64"
          ? Math.floor((content.length * 3) / 4)
          : utf8ByteLen(content);

      const sizeKB = Math.ceil(approxBytes / 1024);
      if (sizeKB > maxFileKB) {
        issues.push({
          code: "E_LIMITS_FILE_SIZE",
          message: `'${f?.path ?? ""}' ~ ${sizeKB}KB > ${maxFileKB}KB`,
          path: `files.${f?.path ?? ""}`,
        });
      }
    }
  }

  // -------- 3) anchors 文本总体体量限制（防止 JSON 过大）--------
  try {
    const anchorsText = JSON.stringify(doc?.anchors ?? {});
    if (utf8ByteLen(anchorsText) > MAX_ANCHORS_TEXT_BYTES) {
      issues.push({
        code: "E_LIMITS_ANCHORS",
        message: `anchors > ${MAX_ANCHORS_TEXT_BYTES} bytes`,
        path: "anchors",
      });
    }
  } catch {
    // stringify 失败不拦截，仅跳过该检查
  }

  return { ok: issues.length === 0, issues };
}
