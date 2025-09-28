// lib/ndjc/validators/path-rules.ts
import type { ContractV1, FileKind } from "../contract/types";
import {
  PACKAGE_ID_PREFIX,
  FORBID_LAYOUT_DIR,
  ALLOWED_FILE_KINDS,
  PATH_RULES,
} from "../constants/contract";

type Issue = { code: string; message: string; path?: string };

export function checkPaths(doc: ContractV1): { issues: Issue[] } {
  const issues: Issue[] = [];

  // 1) packageId 前缀检查
  const pkg = String(doc?.metadata?.packageId ?? "");
  if (!pkg.startsWith(PACKAGE_ID_PREFIX)) {
    issues.push({
      code: "E_PACKAGE_PREFIX",
      message: `packageId must start with ${PACKAGE_ID_PREFIX}`,
      path: "metadata.packageId",
    });
  }

  // 2) files 基本规则
  const allowedKindSet = new Set<FileKind>([...ALLOWED_FILE_KINDS]);

  for (const f of doc.files || []) {
    const kind = (f?.kind ?? "") as FileKind;
    if (!allowedKindSet.has(kind)) {
      issues.push({
        code: "E_FILE_KIND",
        message: `file kind '${kind}' is not allowed`,
        path: `files.${f?.path ?? ""}`,
      });
    }

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

    // 3) PATH_RULES：既支持数组 (string|RegExp)[]，也支持对象 { allowPrefixes, denyPrefixes }
    try {
      const p = String(f?.path ?? "");
      const rules = PATH_RULES as
        | Array<string | RegExp>
        | { allowPrefixes?: string[]; denyPrefixes?: string[] }
        | undefined;

      if (Array.isArray(rules)) {
        // 数组语义：命中任意规则视为违规
        for (const r of rules) {
          const re = r instanceof RegExp ? r : new RegExp(String(r));
          if (re.test(p)) {
            issues.push({
              code: "E_PATH_RULES",
              message: `path '${p}' violates rule ${re}`,
              path: `files.${p}`,
            });
            break;
          }
        }
      } else if (rules && (rules.allowPrefixes || rules.denyPrefixes)) {
        const allow = (rules.allowPrefixes ?? []).map(String);
        const deny = (rules.denyPrefixes ?? []).map(String);

        if (allow.length > 0) {
          const ok = allow.some((pre) => p.startsWith(pre));
          if (!ok) {
            issues.push({
              code: "E_PATH_ALLOW",
              message: `path '${p}' is not under allowed prefixes: [${allow.join(", ")}]`,
              path: `files.${p}`,
            });
          }
        }
        if (deny.length > 0) {
          const hit = deny.find((pre) => p.startsWith(pre));
          if (hit) {
            issues.push({
              code: "E_PATH_DENY",
              message: `path '${p}' starts with denied prefix '${hit}'`,
              path: `files.${p}`,
            });
          }
        }
      }
    } catch {
      // 忽略 PATH_RULES 解析异常
    }
  }

  return { issues };
}
