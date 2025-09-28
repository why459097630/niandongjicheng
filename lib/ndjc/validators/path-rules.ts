// lib/ndjc/validators/path-rules.ts
import type { ContractV1, FileKind } from "../contract/types";
import {
  PACKAGE_ID_PREFIX,       // 字符串前缀，例如 "app.ndjc."
  FORBID_LAYOUT_DIR,       // true 时禁止写入 res/layout
  ALLOWED_FILE_KINDS,      // 允许的 files[].kind 列表（readonly tuple）
  PATH_RULES,              // （可选）附加路径规则，字符串或正则，命中即视为违规
} from "../constants/contract";

type Issue = { code: string; message: string; path?: string };

export function checkPaths(doc: ContractV1): { issues: Issue[] } {
  const issues: Issue[] = [];

  // 1) packageId 前缀检查（字符串 startsWith）
  const pkg = String(doc?.metadata?.packageId ?? "");
  if (!pkg.startsWith(PACKAGE_ID_PREFIX)) {
    issues.push({
      code: "E_PACKAGE_PREFIX",
      message: `packageId must start with ${PACKAGE_ID_PREFIX}`,
      path: "metadata.packageId",
    });
  }

  // 2) files 基本规则
  // 关键：readonly → 可迭代，避免把它断言成可变数组
  const allowedKindSet = new Set<FileKind>([...ALLOWED_FILE_KINDS]);

  for (const f of doc.files || []) {
    // 2.1 kind 白名单
    const kind = (f?.kind ?? "") as FileKind;
    if (!allowedKindSet.has(kind)) {
      issues.push({
        code: "E_FILE_KIND",
        message: `file kind '${kind}' is not allowed`,
        path: `files.${f?.path ?? ""}`,
      });
    }

    // 2.2 禁止 res/layout（Compose 不产 XML 布局）
    if (FORBID_LAYOUT_DIR) {
      const p = String(f?.path ?? "");
      if (/\/res\/layout(\/|$)/.test(p)) {
        issues.push({
          code: "E_FORBID_LAYOUT_DIR",
          message: `writing into res/layout is forbidden`,
          path: `files.${p}`,
        });
      }
    }

    // 2.3 附加 PATH_RULES（命中即视为违规）
    try {
      const p = String(f?.path ?? "");
      for (const r of (PATH_RULES ?? []) as Array<RegExp | string>) {
        const re = r instanceof RegExp ? r : new RegExp(String(r));
        if (re.test(p)) {
          issues.push({
            code: "E_PATH_RULES",
            message: `path '${p}' violates rule ${re}`,
            path: `files.${p}`,
          });
        }
      }
    } catch {
      // 忽略 PATH_RULES 解析错误
    }
  }

  return { issues };
}
